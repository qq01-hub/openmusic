import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compactAiToolResultForModel,
  compactAssistantToolTurn,
  compactReplyContextForPrompt,
  buildQuoteRelationSummary,
  sanitizeOutgoingAiText,
} from './roomAiAgent.js';
import {
  extractEmotionCandidate,
  transitionRoomEmotion,
  validatePreferredCallName,
  recordAiUserInteraction,
  getAiUserProfile,
  clearRoomAiUserState,
} from './roomAiUserState.js';
import { AI_PERSONA_PRESETS, isRoomAiPersonaAllowed } from './aiPersonaPresets.js';
import { buildOpenMusicAiSystemPrompt, buildRoomAiTools } from './aiModelService.js';

test('工具结果发给模型前只保留可决策字段', () => {
  const result = compactAiToolResultForModel('search_songs', {
    success: true,
    keyword: '晴天',
    songs: [{
      id: '1',
      server: 'netease',
      name: '晴天',
      artist: '周杰伦',
      pic: 'https://example.com/cover.jpg',
      url: 'https://example.com/play.mp3',
      lrc: '超长歌词'.repeat(1000),
    }],
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.songs, [{ index: 1, id: '1', server: 'netease', name: '晴天', artist: '周杰伦' }]);
  assert.equal('url' in result.songs[0], false);
  assert.equal('lrc' in result.songs[0], false);

  const status = compactAiToolResultForModel('get_room_status', {
    success: true,
    queuePreview: [{ id: '2', source: 'tencent', name: '稻香', artist: '周杰伦', pic: 'large' }],
    playbackRate: 1,
    playMode: 'order',
  });
  assert.deepEqual(status.queue, [{ index: 1, id: '2', server: 'tencent', name: '稻香', artist: '周杰伦' }]);
});

test('模型回复在上下文中保留原文，不用固定话术替换', () => {
  const text = '我会调用 `search_songs` 帮你找歌';
  assert.equal(compactAssistantToolTurn({ content: text }).content, text);
});

test('引用图片上下文不把原始图片地址重复注入文本模型', () => {
  const compact = compactReplyContextForPrompt({
    available: true,
    id: 'm1',
    userId: 'u1',
    nickname: '小明',
    text: '这是什么歌',
    imageUrl: 'https://example.com/very-long-image.jpg',
    asSticker: false,
    songs: [{ id: '1', server: 'netease', name: '晴天', artist: '周杰伦' }],
    thread: [{ messageId: 'm1', text: '这是什么歌', hasImage: true }],
  });

  assert.equal(compact.hasImage, true);
  assert.equal('imageUrl' in compact, false);
  assert.equal(compact.songs[0].id, '1');
});

test('带工具调用的助手轮次不重复携带长自然语言内容', () => {
  const message = compactAssistantToolTurn({
    content: '这是一段不需要在工具结果后重复发送给模型的长说明'.repeat(100),
    tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'search_songs', arguments: '{}' } }],
  });
  assert.equal(message.role, 'assistant');
  assert.equal(message.content, null);
  assert.equal(message.tool_calls.length, 1);
});

test('工具结果存在异常长提示时仍有硬上限', () => {
  const result = compactAiToolResultForModel('get_qq_faces', {
    success: true,
    faces: Array.from({ length: 20 }, (_, index) => ({ id: String(index), name: '表情'.repeat(500) })),
  });
  assert.ok(JSON.stringify(result).length <= 2400);
});

test('全部AI人格预设通过长度或白名单校验且包含拟人化与自主工具指引', () => {
  assert.equal(AI_PERSONA_PRESETS.length, 5);
  for (const preset of AI_PERSONA_PRESETS) {
    assert.equal(isRoomAiPersonaAllowed(preset.value), true);
    assert.ok(preset.value.length > 100);
  }
  const sysPrompt = buildOpenMusicAiSystemPrompt({ recentQqFaceIds: ['13'] });
  assert.ok(sysPrompt.includes('get_qq_faces'));
  assert.ok(sysPrompt.includes('get_room_status'));
  const toolNames = new Set(buildRoomAiTools().map((t) => t.function.name));
  assert.equal(toolNames.has('get_qq_faces'), true);
  assert.equal(toolNames.has('get_room_status'), true);
});

test('出口仅做最小安全协议清洗，保留模型原文与表情选择', () => {
  assert.equal(
    sanitizeOutgoingAiText('表情包给你了呐 [贴纸:装萌] /doge'),
    '表情包给你了呐 [qqface:179]',
  );
  assert.equal(
    sanitizeOutgoingAiText('LLM 响应错误: All chat models failed: APIStatusError 402 traceId'),
    '',
  );
});

test('引用关系按userId精确区分引用AI本人、引用自己或引用其他群友', () => {
  const selfQuote = buildQuoteRelationSummary('R1', 'u1', '小明', '小肥鱼', {
    available: true,
    userId: '__openmusic_ai__',
    nickname: '小肥鱼',
    text: '你想听哪一版',
  });
  assert.equal(selfQuote.quotedIsBotSelf, true);
  assert.ok(selfQuote.summary.includes('你自己'));

  const thirdQuote = buildQuoteRelationSummary('R1', 'u1', '小明', '小肥鱼', {
    available: true,
    userId: 'u2',
    nickname: '小肥鱼',
    text: '这首真好听',
  });
  assert.equal(thirdQuote.quotedIsBotSelf, false);
  assert.ok(thirdQuote.summary.includes('不是你说的'));
});

test('情绪状态机排除余额误判并支持支配称呼校验', () => {
  assert.equal(extractEmotionCandidate('我的余额还有120多', true), null);
  const happy = extractEmotionCandidate('太棒了谢谢你', true);
  assert.equal(happy.emotion, 'happy');
  const nextState = transitionRoomEmotion(null, happy, 1000, true);
  assert.equal(nextState.emotion, 'happy');

  assert.equal(validatePreferredCallName('主人').ok, false);
  assert.equal(validatePreferredCallName('阿杰').ok, true);

  clearRoomAiUserState('TESTROOM1');
  recordAiUserInteraction('TESTROOM1', 'u100', { text: '在干嘛呢', nickname: '阿杰', now: 1000 });
  const profile = getAiUserProfile('TESTROOM1', 'u100');
  assert.equal(profile.interactionCount, 1);
  clearRoomAiUserState('TESTROOM1');
});
