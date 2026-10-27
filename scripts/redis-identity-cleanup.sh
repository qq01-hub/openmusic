#!/usr/bin/env bash
# OpenMusic Redis 无收藏、无房间关联身份盘点与清理
# 仅连接本机 Redis，默认不删除业务键，需要 Python 3.6+ 标准库
# 保留非空收藏、收藏分类及房间关联，只删除 device 与 user_devices 设备身份数据
# 清理不再限制活跃天数或设备数量，默认不限删除总量，必须停业务写入并保存回滚日志
# 新回滚日志需使用本版脚本恢复，本版仍兼容旧的 v1 日志
set -euo pipefail
if ! command -v python3 >/dev/null 2>&1; then
  printf '%s\n' '需要 Python 3.6+，无需安装 pip 依赖' >&2
  exit 1
fi
export PYTHONIOENCODING=utf-8
exec python3 - "$@" 3<&0 <<'PYTHON'
import argparse
import collections
import json
import os
import re
import socket
import sys
import time
import uuid
from pathlib import Path

DEVICE = 'openmusic:device:'
USER_DEVICES = 'openmusic:user_devices:'
BINDING_TTL = 180 * 86400
ID = re.compile(r'[A-Za-z0-9_-]{8,64}\Z')
TOKEN = re.compile(r'(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{8,64}(?![A-Za-z0-9_-])')
MAX_PROTECTED = 100000
MAX_BULK = 4 * 1024 * 1024
MAX_REPLY = 16 * 1024 * 1024
LEGACY_FORMAT = 'openmusic-device-pairs-v1'
FORMAT = 'openmusic-device-members-v2'

class SafeError(Exception):
    pass

class RedisError(SafeError):
    pass


def emit(**data):
    print(json.dumps(data, ensure_ascii=False), flush=True)


def encode_command(parts):
    values = [str(value).encode('utf-8') for value in parts]
    return b'*' + str(len(values)).encode() + b'\r\n' + b''.join(
        b'$' + str(len(value)).encode() + b'\r\n' + value + b'\r\n' for value in values)


class Redis:
    def __init__(self, port, password, username, database):
        self.sock = socket.create_connection(('127.0.0.1', port), timeout=30)
        self.file = self.sock.makefile('rb')
        try:
            if password is not None:
                self.command('AUTH', username, password) if username else self.command('AUTH', password)
            self.command('SELECT', database)
        except BaseException:
            self.close()
            raise

    def close(self):
        self.file.close()
        self.sock.close()

    def _read(self, depth=0):
        if depth > 16:
            raise SafeError('Redis 响应嵌套过深，已停止')
        line = self.file.readline(65537)
        self.reply_bytes += len(line)
        if not line.endswith(b'\r\n') or len(line) > 65536:
            raise SafeError('Redis 响应无效或连接中断，已停止')
        kind, body = line[:1], line[1:-2]
        if kind == b'-':
            code = body.split(b' ', 1)[0].decode('ascii', errors='replace')
            raise RedisError('Redis 返回错误 ' + re.sub(r'[^A-Z0-9_]', '', code)[:32])
        if kind == b'+':
            return body.decode('utf-8', errors='strict')
        if kind == b':':
            return int(body)
        if kind == b'$':
            size = int(body)
            if size == -1:
                return None
            if size < 0 or size > MAX_BULK or self.reply_bytes + size > MAX_REPLY:
                raise SafeError('单条数据过大，未能完整盘点，禁止继续删除')
            raw = self.file.read(size + 2)
            self.reply_bytes += len(raw)
            if len(raw) != size + 2 or raw[-2:] != b'\r\n':
                raise SafeError('Redis 连接中断，已停止')
            return raw[:-2].decode('utf-8', errors='strict')
        if kind == b'*':
            count = int(body)
            if count == -1:
                return None
            if not 0 <= count <= 20000:
                raise SafeError('Redis 返回集合过大，未能完整盘点，禁止继续删除')
            values = [self._read(depth + 1) for _ in range(count)]
            if self.reply_bytes > MAX_REPLY:
                raise SafeError('Redis 响应过大，已停止')
            return values
        raise SafeError('不支持的 Redis 响应，已停止')

    def pipeline(self, commands):
        self.sock.sendall(b''.join(encode_command(command) for command in commands))
        values = []
        for _ in commands:
            self.reply_bytes = 0
            values.append(self._read())
        return values

    def command(self, *parts):
        return self.pipeline([parts])[0]


INSPECT = r'''
local function typ(k) local t=redis.call('TYPE',k); return type(t)=='table' and t.ok or t end
if typ(KEYS[1])~='string' or redis.call('STRLEN',KEYS[1])>64 then return {0} end
local uid=redis.call('GET',KEYS[1])
if not uid or #uid<8 or not string.match(uid,'^[A-Za-z0-9_-]+$') then return {0} end
local uk='openmusic:user_devices:'..uid
local a=redis.call('TTL',KEYS[1]); local t=typ(uk)
if a==0 or a==-2 then return {4} end
if t=='none' then return {1,uid,a,-2} end
if t~='set' then return {3} end
local did=string.sub(KEYS[1],string.len('openmusic:device:')+1)
if redis.call('SISMEMBER',uk,did)~=1 then return {3} end
local b=redis.call('TTL',uk)
if b==0 or b==-2 then return {4} end
return {1,uid,a,b}
'''

MEMBER_INSPECT = r'''
local function typ(k) local t=redis.call('TYPE',k); return type(t)=='table' and t.ok or t end
if typ(KEYS[1])~='set' then return {0} end
if redis.call('SISMEMBER',KEYS[1],ARGV[2])~=1 then return {0} end
local dk='openmusic:device:'..ARGV[2]; local t=typ(dk)
if t=='string' and redis.call('GET',dk)==ARGV[1] then return {5} end
if t~='none' then return {3} end
local b=redis.call('TTL',KEYS[1])
if b==0 or b==-2 then return {4} end
return {1,ARGV[1],-2,b}
'''

DELETE = r'''#!lua flags=allow-oom
local function typ(k) local t=redis.call('TYPE',k); return type(t)=='table' and t.ok or t end
local dt=typ(KEYS[1]);local ut=typ(KEYS[2])
if ARGV[3]=='1' then
  if dt~='string' or redis.call('GET',KEYS[1])~=ARGV[1] then return {0,0} end
elseif dt~='none' then return {0,0} end
if ARGV[4]=='1' then
  if ut~='set' or redis.call('SISMEMBER',KEYS[2],ARGV[2])~=1 then return {0,0} end
elseif ut~='none' then return {0,0} end
-- 再次保护非空收藏，房间和账户关联以停写后建立的完整名单为准
for _,prefix in ipairs({'openmusic:favorites:','openmusic:favorite-categories:'}) do
  local k=prefix..ARGV[1];local t=typ(k)
  if t~='none' then
    if t~='string' or redis.call('STRLEN',k)>4194304 then return {0,0} end
    local raw=redis.call('GET',k)
    if not string.match(raw,'^%s*%[%s*%]%s*$') then return {0,0} end
  end
end
if redis.call('EXISTS','openmusic:favorite-share-owner:'..ARGV[1])>0 then return {0,0} end
local deleted=0
if ARGV[3]=='1' then deleted=redis.call('UNLINK',KEYS[1]) end
if ARGV[4]=='1' then
  redis.call('SREM',KEYS[2],ARGV[2])
  -- Redis 在最后一个成员移除后自动删除集合键
  if typ(KEYS[2])=='none' then deleted=deleted+1 end
end
return {1,deleted}
'''

RESTORE_V1 = r'''
local function typ(k) local t=redis.call('TYPE',k); return type(t)=='table' and t.ok or t end
local a=typ(KEYS[1]); local b=typ(KEYS[2])
if a=='string' and b=='set' and redis.call('GET',KEYS[1])==ARGV[1]
and redis.call('SCARD',KEYS[2])==1 and redis.call('SISMEMBER',KEYS[2],ARGV[2])==1 then return 0 end
if a~='none' or b~='none' then return -1 end
local now=tonumber(redis.call('TIME')[1]);local da=tonumber(ARGV[3])-now;local db=tonumber(ARGV[4])-now
if da<=0 or db<=0 then return -2 end
redis.call('SET',KEYS[1],ARGV[1],'EX',da)
redis.call('SADD',KEYS[2],ARGV[2]);redis.call('EXPIRE',KEYS[2],db)
return 2
'''


def collect_tokens(raw, protected):
    if not isinstance(raw, str) or len(raw.encode('utf-8')) > MAX_BULK:
        raise SafeError('业务数据格式异常或过大，禁止继续删除')
    stack = [(raw, True)]
    while stack:
        value, root = stack.pop()
        if isinstance(value, str):
            protected.update(TOKEN.findall(value))
            if len(protected) > MAX_PROTECTED:
                raise SafeError('保留名单超过 10 万项，为限制内存占用已停止，尚未开始删除')
            stripped = value.strip()
            if stripped[:1] in ('{', '[', '"'):
                try:
                    parsed = json.loads(stripped)
                except (ValueError, RecursionError):
                    if root:
                        raise SafeError('业务 JSON 无法完整解析，禁止继续删除') from None
                    continue
                if parsed != value:
                    stack.append((parsed, False))
        elif isinstance(value, dict):
            if len(stack) + len(value) * 2 > 20000:
                raise SafeError('业务 JSON 结构过大，为限制内存占用已停止，禁止继续删除')
            stack.extend((item, False) for item in value.keys())
            stack.extend((item, False) for item in value.values())
        elif isinstance(value, list):
            if len(stack) + len(value) > 20000:
                raise SafeError('业务 JSON 结构过大，为限制内存占用已停止，禁止继续删除')
            stack.extend((item, False) for item in value)


def pause(args):
    time.sleep(args.pause_ms / 1000)


def read_business(redis, key, protected, args):
    collect_tokens(key, protected)
    kind = redis.command('TYPE', key)
    if kind == 'none':
        return
    if kind == 'string':
        if redis.command('STRLEN', key) > MAX_BULK:
            raise SafeError('业务字符串超过 4 MiB，未完成盘点，禁止继续删除')
        raw = redis.command('GET', key)
        if raw is not None:
            collect_tokens(raw, protected)
        return
    if kind == 'list':
        count = redis.command('LLEN', key)
        for index in range(count):
            raw = redis.command('LINDEX', key, index)
            if raw is not None:
                collect_tokens(raw, protected)
            if (index + 1) % args.batch_size == 0:
                pause(args)
        return
    operations = {'set': 'SSCAN', 'hash': 'HSCAN', 'zset': 'ZSCAN'}
    if kind not in operations:
        raise SafeError('出现未支持的业务数据类型，未完成盘点，禁止继续删除')
    cursor = '0'
    while True:
        cursor, values = redis.command(operations[kind], key, cursor, 'COUNT', min(args.batch_size, 100))
        for value in values:
            collect_tokens(value, protected)
        pause(args)
        if cursor == '0':
            break


def read_retained_business(redis, key, protected, args):
    # 仅有真实收藏或房间信息才保护身份，空收藏 [] 不算有效收藏
    is_favorite = key.startswith(('openmusic:favorites:', 'openmusic:favorite-categories:'))
    is_room = key.startswith('openmusic:room:')
    if is_favorite or is_room:
        kind = redis.command('TYPE', key)
        if kind == 'none':
            return
        if kind != 'string' or redis.command('STRLEN', key) > MAX_BULK:
            raise SafeError('收藏或房间数据类型异常或过大，未开始删除')
        raw = redis.command('GET', key)
        if raw is None:
            return
        try:
            value = json.loads(raw)
        except (ValueError, RecursionError):
            raise SafeError('收藏或房间 JSON 异常，未开始删除') from None
        if not isinstance(value, list if is_favorite else dict):
            raise SafeError('收藏或房间结构异常，未开始删除')
        if is_favorite and not value:
            return
        collect_tokens(key, protected)
        collect_tokens(raw, protected)
    else:
        read_business(redis, key, protected, args)


def build_protected(redis, args):
    protected = set()
    prefixes = ('openmusic:favorites:', 'openmusic:favorite-categories:',
                'openmusic:favorite-share-owner:', 'openmusic:favorite-share:',
                'openmusic:room:', 'openmusic:account:rooms:')
    cursor, scanned, business, last = '0', 0, 0, time.monotonic()
    while True:
        cursor, keys = redis.command('SCAN', cursor, 'MATCH', 'openmusic:*', 'COUNT', args.batch_size)
        scanned += len(keys)
        for key in keys:
            if key == 'openmusic:room_ids' or key.startswith(prefixes):
                read_retained_business(redis, key, protected, args)
                business += 1
        if time.monotonic() - last >= 5:
            emit(phase='收藏与房间保护名单', scanned_observations=scanned,
                 business_observations=business, protected_tokens=len(protected))
            last = time.monotonic()
        pause(args)
        if cursor == '0':
            break
    # 账户收藏和账户房主需要反查稳定房间身份，不能只看游客 ID
    for account_id in [value for value in protected if value.startswith('acct_')]:
        read_business(redis, 'openmusic:account:' + account_id, protected, args)
        read_business(redis, 'openmusic:account:room-identity-account:' + account_id, protected, args)
    tokens = list(protected)
    for start in range(0, len(tokens), args.batch_size):
        rows = redis.pipeline([('GET', DEVICE + token) for token in tokens[start:start + args.batch_size]])
        for uid in rows:
            if uid is not None:
                if not ID.fullmatch(uid):
                    raise SafeError('房间关联的设备绑定异常，未开始删除')
                protected.add(uid)
        if len(protected) > MAX_PROTECTED:
            raise SafeError('保护名单超过 10 万项，未开始删除')
        pause(args)
    emit(phase='保护名单完成', scanned_observations=scanned, business_observations=business,
         protected_tokens=len(protected), policy='保留非空收藏与房间关联，其余身份不限制活跃时间')
    return protected


def classify(row, did, protected):
    code = row[0]
    if code != 1:
        return {0: 'invalid', 3: 'inconsistent', 4: 'expiring', 5: 'existing_index_member'}.get(code, 'invalid')
    uid, a, b = row[1:]
    if not ID.fullmatch(uid) or not ID.fullmatch(did):
        return 'invalid'
    if uid in protected or did in protected:
        return 'protected'
    if a == 0 or b == 0 or a < -2 or b < -2 or (a == -2 and b == -2):
        return 'invalid'
    return 'candidate'


def expires_at(ttl, observed_at):
    if ttl == -2:
        return None
    if ttl == -1:
        return 0
    return max(1, observed_at + ttl - 1)

def new_journal(args, redis):
    directory = Path(args.backup_dir).expanduser()
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if not directory.is_dir() or directory.stat().st_mode & 0o077:
        raise SafeError('回滚目录必须是仅当前用户可访问的目录，建议使用 /root/openmusic-redis-backup')
    path = directory / ('identity-' + time.strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:8] + '.jsonl')
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    file = os.fdopen(fd, 'w', encoding='utf-8')
    header = dict(format=FORMAT, db=args.db, port=args.port, created_at=int(redis.command('TIME')[0]))
    file.write(json.dumps(header) + '\n')
    file.flush()
    os.fsync(file.fileno())
    emit(phase='回滚日志已创建', rollback_file=str(path.resolve()), note='包含身份信息，请勿公开或发到聊天中')
    return file


def identity_batches(redis, args):
    sha = redis.command('SCRIPT', 'LOAD', INSPECT)
    cursor = '0'
    while True:
        cursor, keys = redis.command('SCAN', cursor, 'MATCH', DEVICE + '*', 'COUNT', args.batch_size)
        for start in range(0, len(keys), args.batch_size):
            batch = keys[start:start + args.batch_size]
            now = int(redis.command('TIME')[0])
            rows = redis.pipeline([('EVALSHA_RO', sha, 1, key) for key in batch])
            yield now, [(key[len(DEVICE):], row) for key, row in zip(batch, rows)]
        pause(args)
        if cursor == '0':
            break
    # 第二遍移除设备键已不存在的索引成员，正常设备不会重复计入候选
    sha = redis.command('SCRIPT', 'LOAD', MEMBER_INSPECT)
    cursor = '0'
    while True:
        cursor, keys = redis.command('SCAN', cursor, 'MATCH', USER_DEVICES + '*', 'COUNT', args.batch_size)
        for key in keys:
            uid = key[len(USER_DEVICES):]
            kind = redis.command('TYPE', key)
            if kind == 'none':
                continue
            if not ID.fullmatch(uid) or kind != 'set':
                yield 0, [('', [0])]
                continue
            member_cursor = '0'
            while True:
                member_cursor, members = redis.command('SSCAN', key, member_cursor, 'COUNT', args.batch_size)
                for start in range(0, len(members), args.batch_size):
                    batch = members[start:start + args.batch_size]
                    now = int(redis.command('TIME')[0])
                    rows = redis.pipeline([('EVALSHA_RO', sha, 1, key, uid, did) for did in batch])
                    yield now, list(zip(batch, rows))
                pause(args)
                if member_cursor == '0':
                    break
        pause(args)
        if cursor == '0':
            break


def inspect_bindings(redis, args, protected, journal=None):
    delete_sha = redis.command('SCRIPT', 'LOAD', DELETE) if args.apply else None
    stats = collections.Counter(deleted_keys=0, removed_bindings=0)
    last = time.monotonic()
    for observed_at, rows in identity_batches(redis, args):
        candidates, seen = [], set()
        for did, row in rows:
            result = classify(row, did, protected)
            stats[result] += 1
            stats['scanned_observations'] += 1
            if result == 'candidate' and args.apply:
                if args.max_delete_keys and stats['deleted_keys'] + (len(candidates) + 1) * 2 > args.max_delete_keys:
                    stats['limit_reached'] = 1
                    break
                uid, a, b = row[1:]
                if (did, uid) not in seen:
                    candidates.append(dict(device_id=did, user_id=uid,
                                      device_expires_at=expires_at(a, observed_at),
                                      user_devices_expires_at=expires_at(b, observed_at)))
                    seen.add((did, uid))
        if candidates:
            ensure_no_background_save(redis)
            # 必须先落盘并 fsync，再执行任何删除，异常或断网后也能回滚
            for record in candidates:
                journal.write(json.dumps(record) + '\n')
            journal.flush()
            os.fsync(journal.fileno())
            results = redis.pipeline([('EVALSHA', delete_sha, 2, DEVICE + row['device_id'],
                                       USER_DEVICES + row['user_id'], row['user_id'], row['device_id'],
                                       int(row['device_expires_at'] is not None),
                                       int(row['user_devices_expires_at'] is not None)) for row in candidates])
            stats['removed_bindings'] += sum(result[0] for result in results)
            stats['deleted_keys'] += sum(result[1] for result in results)
            stats['recheck_skipped'] += sum(result[0] == 0 for result in results)
        if stats['limit_reached']:
            emit(phase='达到本次删除上限', **stats)
            return stats
        if time.monotonic() - last >= 5:
            emit(phase='清理中' if args.apply else '只读盘点中', **stats)
            last = time.monotonic()
        pause(args)
    return stats

def load_legacy_record(line):
    if len(line) > 4096:
        raise SafeError('回滚日志记录过大，已停止')
    value = json.loads(line)
    if not isinstance(value, dict):
        raise SafeError('回滚日志格式错误')
    for field in ('device_id', 'user_id'):
        if not isinstance(value.get(field), str) or not ID.fullmatch(value[field]):
            raise SafeError('回滚日志身份格式错误')
    for field in ('device_expires_at', 'user_devices_expires_at'):
        if type(value.get(field)) is not int or value[field] <= 0:
            raise SafeError('回滚日志过期时间格式错误')
    return value


def restore_legacy_journal(redis, args):
    path = Path(args.restore)
    now = int(redis.command('TIME')[0])
    # 先完整校验一遍，不在读到半途才发现文件格式损坏
    with path.open('r', encoding='utf-8') as file:
        header = json.loads(file.readline(4097))
        if header.get('format') != LEGACY_FORMAT or header.get('db') != args.db or header.get('port') != args.port:
            raise SafeError('回滚日志版本、数据库或端口不匹配，禁止恢复')
        for line in file:
            row = load_legacy_record(line)
            if max(row['device_expires_at'], row['user_devices_expires_at']) > now + BINDING_TTL:
                raise SafeError('回滚日志有效期超出当前项目约定，未开始恢复')
    sha = redis.command('SCRIPT', 'LOAD', RESTORE_V1)
    stats = collections.Counter()
    now = int(redis.command('TIME')[0])
    with path.open('r', encoding='utf-8') as file:
        next(file)
        for line in file:
            row = load_record(line)
            if max(row['device_expires_at'], row['user_devices_expires_at']) > now + BINDING_TTL:
                raise SafeError('回滚日志有效期超出当前项目约定，已停止')
            if sum(stats.values()) % args.batch_size == 0:
                ensure_no_background_save(redis)
            did, uid = row['device_id'], row['user_id']
            result = redis.command('EVALSHA', sha, 2, DEVICE + did, USER_DEVICES + uid, uid, did,
                                   row['device_expires_at'], row['user_devices_expires_at'])
            name = {2: 'restored_keys', 0: 'already_present', -1: 'conflicts', -2: 'expired'}[result]
            stats[name] += 2 if result == 2 else 1
            if sum(stats.values()) % args.batch_size == 0:
                emit(phase='回滚中', **stats)
                pause(args)
    return stats


RESTORE = r'''
local function typ(k) local t=redis.call('TYPE',k); return type(t)=='table' and t.ok or t end
local de=tonumber(ARGV[3]);local ue=tonumber(ARGV[4]);local now=tonumber(redis.call('TIME')[1])
if (de>0 and de<=now) or (ue>0 and ue<=now) then return -2 end
local dt=typ(KEYS[1]);local ut=typ(KEYS[2])
if dt~='none' and (dt~='string' or redis.call('GET',KEYS[1])~=ARGV[1]) then return -1 end
if ue~=-2 and ut~='none' then
  if ut~='set' or redis.call('SCARD',KEYS[2])>1000 then return -1 end
  for _,did in ipairs(redis.call('SMEMBERS',KEYS[2])) do
    local dk='openmusic:device:'..did;local t=typ(dk)
    if t~='none' and (t~='string' or redis.call('GET',dk)~=ARGV[1]) then return -1 end
  end
end
local changed=0
if de~=-2 and dt=='none' then
  if de==0 then redis.call('SET',KEYS[1],ARGV[1])
  else redis.call('SET',KEYS[1],ARGV[1],'EX',de-now) end
  changed=changed+1
end
if ue~=-2 then
  local added=redis.call('SADD',KEYS[2],ARGV[2]);changed=changed+added
  if ue>0 then
    local ttl=redis.call('TTL',KEYS[2]);local remaining=ue-now
    if ut=='none' or ttl==-1 or ttl>remaining then redis.call('EXPIRE',KEYS[2],remaining) end
  end
end
return changed
'''


def restore_expiry(value):
    return -2 if value is None else value


def load_record(line):
    if len(line) > 4096:
        raise SafeError('回滚日志记录过大，已停止')
    value = json.loads(line)
    if not isinstance(value, dict):
        raise SafeError('回滚日志格式错误')
    for field in ('device_id', 'user_id'):
        if not isinstance(value.get(field), str) or not ID.fullmatch(value[field]):
            raise SafeError('回滚日志身份格式错误')
    for field in ('device_expires_at', 'user_devices_expires_at'):
        if field not in value or (value[field] is not None and
                (type(value[field]) is not int or not 0 <= value[field] <= 9007199254740991)):
            raise SafeError('回滚日志过期时间格式错误')
    if value['device_expires_at'] is None and value['user_devices_expires_at'] is None:
        raise SafeError('回滚日志不能包含两个都不存在的键')
    return value


def journal_records(file):
    while True:
        line = file.readline(4097)
        if not line:
            return
        yield load_record(line)


def restore_journal(redis, args):
    path = Path(args.restore)
    with path.open('r', encoding='utf-8') as file:
        header = json.loads(file.readline(4097))
        if not isinstance(header, dict):
            raise SafeError('回滚日志头格式错误')
        if header.get('format') == LEGACY_FORMAT:
            return restore_legacy_journal(redis, args)
        if header.get('format') != FORMAT or header.get('db') != args.db or header.get('port') != args.port:
            raise SafeError('回滚日志版本、数据库或端口不匹配，禁止恢复')
        # 在修改前完整校验日志，新格式支持多设备、永久键和单侧缺失的绑定
        for row in journal_records(file):
            pass
    sha = redis.command('SCRIPT', 'LOAD', RESTORE)
    stats = collections.Counter()
    with path.open('r', encoding='utf-8') as file:
        next(file)
        for index, row in enumerate(journal_records(file)):
            if index % args.batch_size == 0:
                ensure_no_background_save(redis)
                pause(args)
            result = redis.command('EVALSHA', sha, 2, DEVICE + row['device_id'], USER_DEVICES + row['user_id'],
                                   row['user_id'], row['device_id'], restore_expiry(row['device_expires_at']),
                                   restore_expiry(row['user_devices_expires_at']))
            stats[{-2: 'expired', -1: 'conflicts', 0: 'already_present'}.get(result, 'restored_records')] += 1
            if (index + 1) % args.batch_size == 0:
                emit(phase='回滚中', **stats)
    return stats


def build_parser():
    parser = argparse.ArgumentParser(description='OpenMusic 无收藏无房间身份清理，默认只读盘点，apply 默认清理全部候选')
    parser.add_argument('--db', type=int, required=True, help='必须显式指定，当前站点是 1，不要误查 DB 0')
    parser.add_argument('--port', type=int, default=6379)
    parser.add_argument('--username', default=os.environ.get('REDISCLI_USER'))
    parser.add_argument('--no-auth', action='store_true', help='仅用于明确未启用认证的本机实例')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--apply', action='store_true', help='清理全部候选，必须停应用写入并确认影响')
    mode.add_argument('--restore', metavar='JSONL', help='按日志恢复，不覆盖已存在或冲突的绑定')
    parser.add_argument('--batch-size', type=int, default=500, help='SCAN 工作量和客户端分批上限，默认 500')
    parser.add_argument('--pause-ms', type=int, default=50, help='批次间暂停毫秒数，默认 50')
    parser.add_argument('--max-delete-keys', type=int, default=0, help='默认 0 不设删除上限，可指定 2 到 1000000 限量执行')
    parser.add_argument('--backup-dir', help='清理回滚日志目录，必须私有，apply 时必填')
    parser.add_argument('--maintenance-confirmed', action='store_true', help='确认已停止所有应用实例及其他业务写入')
    parser.add_argument('--accept-guest-reset', action='store_true', help='接受所有无收藏无房间身份重建，包括近期活跃和多设备用户')
    return parser


def validate_options(args):
    if args.db < 0 or not 1 <= args.port <= 65535:
        raise SafeError('数据库编号或端口无效')
    if not 1 <= args.batch_size <= 1000 or not 1 <= args.pause_ms <= 10000:
        raise SafeError('批次大小必须为 1 到 1000，暂停必须为 1 到 10000 毫秒')
    if args.max_delete_keys != 0 and not 2 <= args.max_delete_keys <= 1000000:
        raise SafeError('删除键数上限必须为 0 或 2 到 1000000，0 表示不限量')
    if (args.apply or args.restore) and not args.maintenance_confirmed:
        raise SafeError('清理和回滚前必须停止所有应用写入，再指定 --maintenance-confirmed')
    if args.apply and (not args.backup_dir or not args.accept_guest_reset):
        raise SafeError('清理还需要 --backup-dir 和 --accept-guest-reset')


def info(redis, section):
    raw = redis.command('INFO', section)
    return dict(line.split(':', 1) for line in raw.splitlines() if ':' in line and not line.startswith('#'))


def ensure_no_background_save(redis):
    persistence = info(redis, 'persistence')
    if persistence.get('rdb_bgsave_in_progress') == '1' or persistence.get('aof_rewrite_in_progress') == '1':
        raise SafeError('Redis 后台保存或重写已开始，停止继续修改，请保留日志并等待结束')


def tty_read(prompt, secret=False):
    import termios

    fd = None
    saved = None
    try:
        try:
            fd = os.open('/dev/tty', os.O_RDWR)
        except OSError:
            # Python 的标准输入用于脚本源码，从外壳保留的 fd 3 读取终端输入
            fd = os.dup(3)
        if not os.isatty(fd):
            raise SafeError('输入不是交互终端，请使用交互式 SSH；盘点认证也可使用 REDISCLI_AUTH 环境变量')
        if secret:
            saved = termios.tcgetattr(fd)
            hidden = saved[:]
            hidden[3] &= ~(termios.ECHO | termios.ECHONL)
            termios.tcsetattr(fd, termios.TCSADRAIN, hidden)
        sys.stderr.write(prompt)
        sys.stderr.flush()
        data = bytearray()
        while True:
            char = os.read(fd, 1)
            if not char:
                raise SafeError('终端输入已关闭，未接受密码或操作确认')
            if char in (b'\n', b'\r'):
                return data.decode('utf-8')
            data.extend(char)
            if len(data) > 4096:
                raise SafeError('终端输入过长，已停止')
    except (OSError, UnicodeError):
        raise SafeError('无法读取终端，请使用交互式 SSH；盘点认证也可使用 REDISCLI_AUTH 环境变量') from None
    finally:
        try:
            if saved is not None:
                termios.tcsetattr(fd, termios.TCSADRAIN, saved)
        finally:
            if fd is not None:
                os.close(fd)
            if secret and saved is not None:
                sys.stderr.write('\n')
                sys.stderr.flush()


def main():
    args = build_parser().parse_args()
    validate_options(args)
    if sys.version_info < (3, 6):
        raise SafeError('需要 Python 3.6 或更高版本')
    password = None if args.no_auth else os.environ.pop('REDISCLI_AUTH', None)
    if not args.no_auth and password is None:
        password = tty_read('Redis 密码（隐藏输入，不记录到命令行）: ', secret=True)
    redis = Redis(args.port, password, args.username, args.db)
    journal = None
    try:
        server = info(redis, 'server')
        if server.get('redis_mode') != 'standalone' or int(server['redis_version'].split('.')[0]) < 7:
            raise SafeError('仅支持 Redis 7+ standalone，当前环境不适用，未修改业务数据')
        before = redis.command('DBSIZE')
        memory = info(redis, 'memory')
        emit(mode='apply' if args.apply else 'restore' if args.restore else 'audit', db=args.db,
             redis_version=server['redis_version'], keys_before=before,
             used_memory_before=memory.get('used_memory_human'),
             policy='无非空收藏且无房间关联的身份全部清理', max_delete_keys=args.max_delete_keys)
        if args.apply or args.restore:
            persistence = info(redis, 'persistence')
            if persistence.get('rdb_bgsave_in_progress') == '1' or persistence.get('aof_rewrite_in_progress') == '1':
                raise SafeError('Redis 正在后台保存或重写，请等待结束后再执行清理或回滚')
            expected = ('RESTORE' if args.restore else 'CLEAN') + ' DB' + str(args.db)
            if tty_read('确认已停止全部业务写入，接受无收藏无房间的近期及多设备身份被重置，输入 ' + expected + ' 继续: ') != expected:
                raise SafeError('确认文字不匹配，未开始修改')
        if args.restore:
            stats = restore_journal(redis, args)
        else:
            if not before:
                raise SafeError('当前数据库为空，请核对 --db，未修改业务数据')
            emit(note='先完整建立业务保留名单，再扫描设备绑定，耗时取决于磁盘换页和键数量，Ctrl+C 可停止')
            protected = build_protected(redis, args)
            if args.apply:
                journal = new_journal(args, redis)
            stats = inspect_bindings(redis, args, protected, journal)
        after_memory = info(redis, 'memory')
        emit(phase='完成', db=args.db, keys_after=redis.command('DBSIZE'),
             used_memory_after=after_memory.get('used_memory_human'), **stats)
        if not args.apply and not args.restore:
            emit(note='候选不是已证明的机器人，SCAN 可能重复返回，candidate 为扫描观察数，不是精确可删总数')
        if stats.get('conflicts'):
            raise SafeError('存在绑定冲突，未覆盖冲突数据，请保留日志人工核对')
    finally:
        if journal:
            journal.close()
        redis.close()


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('\n已停止，若已执行清理，请保留已打印路径中的回滚日志', file=sys.stderr)
        sys.exit(130)
    except Exception as error:
        message = str(error) if isinstance(error, SafeError) else '连接、文件或数据解析失败，已停止，不输出凭据或业务内容'
        print('错误: ' + message, file=sys.stderr)
        print('默认盘点不会删除数据；仅当已开始清理或回滚时，需保留回滚日志', file=sys.stderr)
        sys.exit(1)
PYTHON
