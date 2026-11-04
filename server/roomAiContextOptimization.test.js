import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compactAiToolResultForModel,
  compactAssistantToolTurn,
  compactReplyContextForPrompt,
} from './roomAiAgent.js';

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
