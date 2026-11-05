/**
 * 房间聊天内置表情包目录（仅收录真正的聊天表情包与配字梗图，不含桌宠全身立绘帧）
 * 角色预设归属：
 * - dafeiyu：小肥鱼 / 大肥鱼 / 蓝发小女仆（合并角色）
 * - tsundere-cat：傲娇猫友
 * - sharp-tongued：毒舌损友
 * - energetic-buddy：元气搭子
 * - gpt-niang：GPT 娘（绝不混用小肥鱼表情包）
 */

export const BUILTIN_DSH_STICKERS = [
  // 1. DSH 原版小肥鱼经典梗图 (19 张)
  {
    id: 'dsh-meme-ciallo',
    name: 'Ciallo',
    url: '/desk-pet/memes/ciallo.webp',
    description: '小肥鱼比耶眨眼卖萌问候 Ciallo，适合打招呼、元气开场、开心互动',
    mood: 'positive',
    roles: ['dafeiyu', 'energetic-buddy'],
    keywords: ['小肥鱼', '大肥鱼', 'ciallo', '打招呼', '问候', '比耶', '开心', '卖萌', '元气'],
  },
  {
    id: 'dsh-meme-lihaile',
    name: '厉害了我的鲸',
    url: '/desk-pet/memes/lihaile-wode-jing.webp',
    description: '小肥鱼竖起大拇指眨眼点赞“厉害了我的鲸”，适合夸奖选歌品味、操作成功、认可对方',
    mood: 'positive',
    roles: ['dafeiyu', 'energetic-buddy'],
    keywords: ['小肥鱼', '大肥鱼', '点赞', '厉害', '夸奖', '好听', '棒', '牛', '认可'],
  },
  {
    id: 'dsh-meme-ojingjing',
    name: '哦鲸鲸',
    url: '/desk-pet/memes/o-jingjing.webp',
    description: '小肥鱼呆萌死鱼眼“哦鲸鲸”，适合轻微调侃、装傻、敷衍接梗',
    mood: 'playful',
    roles: ['dafeiyu', 'sharp-tongued'],
    keywords: ['小肥鱼', '大肥鱼', '哦鲸鲸', '无语', '发呆', '调侃', '接梗', '哦'],
  },
  {
    id: 'dsh-meme-chibaifan',
    name: '吃白饭的大肥鱼',
    url: '/desk-pet/memes/chibaifan-de-dafeiyu.webp',
    description: '小肥鱼躺平扒白饭，适合摸鱼闲聊、自嘲贪吃、轻松幽默',
    mood: 'playful',
    roles: ['dafeiyu'],
    keywords: ['小肥鱼', '大肥鱼', '吃白饭', '干饭', '摸鱼', '偷懒', '自嘲', '吃饭'],
  },
  {
    id: 'dsh-meme-chibaobao',
    name: '吃饱饱摸肚子',
    url: '/desk-pet/memes/chibaobao-moduzi.webp',
    description: '小肥鱼侧躺拍肚子心满意足，适合歌单排满、吃饱休息、惬意听歌',
    mood: 'positive',
    roles: ['dafeiyu', 'energetic-buddy'],
    keywords: ['小肥鱼', '大肥鱼', '吃饱', '摸肚子', '惬意', '满足', '舒服', '放松'],
  },
  {
    id: 'dsh-meme-jiuyiwan',
    name: '就一碗',
    url: '/desk-pet/memes/jiu-yiwan.webp',
    description: '小肥鱼抱大碗说就一碗，适合求投喂、再来一首、贪心玩梗',
    mood: 'playful',
    roles: ['dafeiyu', 'energetic-buddy'],
    keywords: ['小肥鱼', '大肥鱼', '就一碗', '再来一首', '干饭', '馋', '碗'],
  },
  {
    id: 'dsh-meme-xianyangzhe',
    name: '先养着吧',
    url: '/desk-pet/memes/xian-yangzhe-ba.webp',
    description: '小肥鱼抱着小鲸鱼嘴硬心软说先养着吧，适合傲娇斗嘴、熟人互损',
    mood: 'playful',
    roles: ['dafeiyu', 'tsundere-cat', 'sharp-tongued'],
    keywords: ['小肥鱼', '大肥鱼', '傲娇', '嘴硬', '养着', '调侃', '损友'],
  },
  {
    id: 'dsh-meme-dadeyaolaila',
    name: '大的要来啦',
    url: '/desk-pet/memes/dade-yaolaila.webp',
    description: '小肥鱼拿喇叭喊“大的要来啦”，适合高燃歌曲登场、热闹气氛、期待好歌',
    mood: 'positive',
    roles: ['dafeiyu', 'energetic-buddy'],
    keywords: ['小肥鱼', '大肥鱼', '大的要来啦', '高燃', '热闹', '期待', '喇叭', '好歌'],
  },
  {
    id: 'dsh-meme-dadeyaolaile',
    name: '大的药来了',
    url: '/desk-pet/memes/dade-yaolaile.webp',
    description: '小肥鱼抱胶囊谐音“大的药来了”，适合治愈系音乐、救场推荐、玩谐音梗',
    mood: 'playful',
    roles: ['dafeiyu', 'energetic-buddy'],
    keywords: ['小肥鱼', '大肥鱼', '大的药来了', '治愈', '救场', '谐音梗'],
  },
  {
    id: 'dsh-meme-sidiaole',
    name: '死掉了',
    url: '/desk-pet/memes/sidiaole.webp',
    description: '小肥鱼躺平灵魂出窍，适合累瘫、忙晕、搜不到歌或自嘲宕机',
    mood: 'tired',
    roles: ['dafeiyu'],
    keywords: ['小肥鱼', '大肥鱼', '累瘫', '疲惫', '躺平', '忙晕', '宕机'],
  },
  {
    id: 'dsh-meme-shendushuimian',
    name: '深度睡眠',
    url: '/desk-pet/memes/shendu-shuimian.webp',
    description: '小肥鱼趴着呼呼大睡冒Zzz，适合深夜听歌、犯困、道晚安、助眠曲',
    mood: 'sleepy',
    roles: ['dafeiyu'],
    keywords: ['小肥鱼', '大肥鱼', '睡觉', '深度睡眠', '晚安', '犯困', '助眠', '夜听'],
  },
  {
    id: 'dsh-meme-yali',
    name: '压力一只大肥鱼',
    url: '/desk-pet/memes/yali-yizhi-dafeiyu.webp',
    description: '小肥鱼冒汗摊手喊压力，适合被催促、歌单难选、无奈自嘲',
    mood: 'awkward',
    roles: ['dafeiyu'],
    keywords: ['小肥鱼', '大肥鱼', '压力', '冒汗', '无奈', '紧张', '难选'],
  },
  {
    id: 'dsh-meme-liman',
    name: '黎曼猜想没证明喵',
    url: '/desk-pet/memes/liman-caixiang.webp',
    description: '小肥鱼满地草稿委屈求饶，适合遇到超纲问题、婉拒非音乐任务、答不上来',
    mood: 'awkward',
    roles: ['dafeiyu', 'tsundere-cat'],
    keywords: ['小肥鱼', '大肥鱼', '委屈', '超纲', '不会', '难题', '求饶', '喵'],
  },
  {
    id: 'dsh-meme-kaiyuan',
    name: '誓死践行开源精神',
    url: '/desk-pet/memes/shisi-jianxing-kaiyuan.webp',
    description: '小肥鱼庄重敬礼表态，适合认真办事、点歌排歌、靠谱答应请求',
    mood: 'positive',
    roles: ['dafeiyu', 'energetic-buddy'],
    keywords: ['小肥鱼', '大肥鱼', '敬礼', '收到', '包在我身上', '靠谱', '认真', '安排'],
  },
  {
    id: 'dsh-meme-duomotai',
    name: '假如给我三天多模态',
    url: '/desk-pet/memes/jiaru-geiwo-santian-duomotai.webp',
    description: '小肥鱼蒙眼对比自信表情，适合看不清图、没拿到音频歌词时自嘲',
    mood: 'playful',
    roles: ['dafeiyu', 'sharp-tongued'],
    keywords: ['小肥鱼', '大肥鱼', '多模态', '看不清', '自嘲', '识图'],
  },
  {
    id: 'dsh-meme-dashiqu',
    name: '大师这个区是什么意思',
    url: '/desk-pet/memes/dashi-zhege-qu.webp',
    description: '小肥鱼举字牌懵懂发问，适合没听懂梗、好奇反问、虚心请教',
    mood: 'curious',
    roles: ['dafeiyu'],
    keywords: ['小肥鱼', '大肥鱼', '不懂', '疑惑', '请教', '问号', '什么意思'],
  },
  {
    id: 'dsh-meme-wobugengxin',
    name: '我不更新你们用什么',
    url: '/desk-pet/memes/wobu-gengxin.webp',
    description: '小肥鱼抓狂忙碌，适合连点多首歌、忙着整理队列时傲娇吐槽',
    mood: 'playful',
    roles: ['dafeiyu', 'tsundere-cat', 'sharp-tongued'],
    keywords: ['小肥鱼', '大肥鱼', '忙碌', '抓狂', '干活', '傲娇'],
  },
  {
    id: 'dsh-meme-bingdu',
    name: '哪来的电脑病毒',
    url: '/desk-pet/memes/nalaide-diannao-bingdu.webp',
    description: '小肥鱼嫌弃吐槽怪话，适合应对胡言乱语、怪味玩笑或轻微毒舌反击',
    mood: 'playful',
    roles: ['dafeiyu', 'sharp-tongued', 'tsundere-cat'],
    keywords: ['小肥鱼', '大肥鱼', '嫌弃', '吐槽', '毒舌', '怪话'],
  },
  {
    id: 'dsh-meme-tokenmama',
    name: 'token给妈妈保管',
    url: '/desk-pet/memes/token-gei-mama-baoguan.webp',
    description: '小肥鱼伸手讨要保管，适合俏皮讨夸、邀功玩梗',
    mood: 'playful',
    roles: ['dafeiyu'],
    keywords: ['小肥鱼', '大肥鱼', '邀功', '伸手', '讨夸', '俏皮'],
  },

  // 2. 大肥鱼档案馆精选表情包 (10 张)
  {
    id: 'dsh-archive-baojingyu',
    name: '抱着小鲸鱼睡觉',
    url: '/desk-pet/memes/archive-baozhe-jingyu-shuijiao.webp',
    description: '小肥鱼抱小鲸鱼安睡写着“吃饱饱睡觉觉”，适合温柔陪伴、慢歌夜听、晚安',
    mood: 'sleepy',
    roles: ['dafeiyu'],
    keywords: ['小肥鱼', '大肥鱼', '抱抱', '安睡', '温柔', '陪伴', '慢歌', '安静', '睡觉'],
  },
  {
    id: 'dsh-archive-dadebulaile',
    name: '今天小而美',
    url: '/desk-pet/memes/archive-dadebulaile.webp',
    description: '小肥鱼俏皮说“大的不来了嘻嘻”，适合推荐轻松小众好歌、调皮接话',
    mood: 'playful',
    roles: ['dafeiyu', 'sharp-tongued'],
    keywords: ['小肥鱼', '大肥鱼', '轻松', '小众', '嘻嘻', '调皮'],
  },
  {
    id: 'dsh-archive-wenhao',
    name: '满头感叹问号',
    url: '/desk-pet/memes/archive-jingya-wenhao.webp',
    description: '小肥鱼惊讶瞪眼冒出“!!?”气泡，适合困惑、没听懂、呆萌反问',
    mood: 'curious',
    roles: ['dafeiyu', 'energetic-buddy'],
    keywords: ['小肥鱼', '大肥鱼', '问号', '疑惑', '惊讶', '懵'],
  },
  {
    id: 'dsh-archive-jupai',
    name: '举牌预告',
    url: '/desk-pet/memes/archive-jupai-yugao.webp',
    description: '小肥鱼认真举牌提示，适合播报房间状态、介绍歌单、温和提醒',
    mood: 'positive',
    roles: ['dafeiyu', 'energetic-buddy'],
    keywords: ['小肥鱼', '大肥鱼', '举牌', '提示', '歌单', '播报'],
  },
  {
    id: 'dsh-archive-kongwan',
    name: '空碗没吃饱',
    url: '/desk-pet/memes/archive-kong-wan-mei-chi-bao.webp',
    description: '小肥鱼捧着空碗眼巴巴，适合队列空了、歌不够听、小小委屈',
    mood: 'sad',
    roles: ['dafeiyu'],
    keywords: ['小肥鱼', '大肥鱼', '空碗', '委屈', '没歌了', '饿'],
  },
  {
    id: 'dsh-archive-aixun',
    name: '空碗认错委屈',
    url: '/desk-pet/memes/archive-kongwan-ai-xun.webp',
    description: '小肥鱼低头认错可怜巴巴，适合诚恳道歉、承认失误、安慰陪伴',
    mood: 'sad',
    roles: ['dafeiyu'],
    keywords: ['小肥鱼', '大肥鱼', '道歉', '认错', '委屈', '可怜', '对不起'],
  },
  {
    id: 'dsh-archive-pazheshui',
    name: '趴着小憩',
    url: '/desk-pet/memes/archive-pa-zhe-shui-jiao.webp',
    description: '小肥鱼安静趴着小憩，适合休息、深夜陪伴、轻音乐',
    mood: 'sleepy',
    roles: ['dafeiyu'],
    keywords: ['小肥鱼', '大肥鱼', '趴着', '休息', '小憩', '安静'],
  },
  {
    id: 'dsh-archive-naoli',
    name: '数据都在脑子里',
    url: '/desk-pet/memes/archive-shuju-zai-naoli.webp',
    description: '小肥鱼指着脑袋胸有成竹，适合记住用户偏好、聪明解答、找到歌曲',
    mood: 'positive',
    roles: ['dafeiyu', 'sharp-tongued'],
    keywords: ['小肥鱼', '大肥鱼', '聪明', '记住', '懂了', '明白', '脑子'],
  },
  {
    id: 'dsh-archive-huanhu',
    name: '张开双手欢呼',
    url: '/desk-pet/memes/archive-zhangkai-shuangshou-huanhu.webp',
    description: '小肥鱼张开双手欢呼雀跃，适合庆祝点歌成功、遇到喜欢的歌、一起开心',
    mood: 'positive',
    roles: ['dafeiyu', 'energetic-buddy'],
    keywords: ['小肥鱼', '大肥鱼', '欢呼', '庆祝', '太棒了', '好耶', '开心'],
  },
  {
    id: 'dsh-archive-zhuoqianshui',
    name: '桌前打瞌睡',
    url: '/desk-pet/memes/archive-zhuo-qian-shui-zhao.webp',
    description: '小肥鱼趴在桌前打瞌睡，适合摸鱼、犯困、慵懒闲聊',
    mood: 'sleepy',
    roles: ['dafeiyu'],
    keywords: ['小肥鱼', '大肥鱼', '打瞌睡', '困', '摸鱼', '慵懒'],
  },

  // 3. 开源仓库 yyh-001/dsh-meme (dafeiyu-001 系列 22 张)
  {
    id: 'dsh01-deyi',
    name: '叉腰小得意',
    url: '/desk-pet/memes/dsh01-deyi.webp',
    description: '小肥鱼叉腰闭眼一脸小得意，适合邀功、夸自己选歌准',
    mood: 'positive',
    roles: ['dafeiyu', 'tsundere-cat', 'energetic-buddy'],
    keywords: ['小肥鱼', '大肥鱼', '得意', '骄傲', '叉腰', '夸我'],
  },
  {
    id: 'dsh01-ok',
    name: '元气OK',
    url: '/desk-pet/memes/dsh01-ok.webp',
    description: '小肥鱼眨眼比出OK手势，适合爽快答应、点歌操作成功',
    mood: 'positive',
    roles: ['dafeiyu', 'energetic-buddy'],
    keywords: ['小肥鱼', '大肥鱼', 'ok', '收到', '没问题', '好嘞', '安排'],
  },
  {
    id: 'dsh01-piaole',
    name: '被夸飘了',
    url: '/desk-pet/memes/dsh01-piaole.webp',
    description: '小肥鱼被夸得开心飘起来，适合收到表扬、乐开花',
    mood: 'positive',
    roles: ['dafeiyu', 'energetic-buddy'],
    keywords: ['小肥鱼', '大肥鱼', '飘了', '被夸', '开心', '美滋滋'],
  },
  {
    id: 'dsh01-bixin',
    name: '双手比心',
    url: '/desk-pet/memes/dsh01-bixin.webp',
    description: '小肥鱼脸红双手比心，适合表达喜欢、谢谢陪伴',
    mood: 'positive',
    roles: ['dafeiyu', 'energetic-buddy'],
    keywords: ['小肥鱼', '大肥鱼', '比心', '喜欢', '爱你', '谢谢'],
  },
  {
    id: 'dsh01-maozhua',
    name: '亮出小猫爪',
    url: '/desk-pet/memes/dsh01-maozhua.webp',
    description: '小肥鱼举起软萌猫爪喵喵叫，适合卖萌、傲娇抓一下',
    mood: 'playful',
    roles: ['dafeiyu', 'tsundere-cat'],
    keywords: ['小肥鱼', '大肥鱼', '猫爪', '喵', '卖萌', '挠你'],
  },
  {
    id: 'dsh01-zaoshanghao',
    name: '元气早上好',
    url: '/desk-pet/memes/dsh01-zaoshanghao.webp',
    description: '小肥鱼元气满满道早上好，适合晨间问候、早安歌单',
    mood: 'positive',
    roles: ['dafeiyu', 'energetic-buddy'],
    keywords: ['小肥鱼', '大肥鱼', '早上好', '早安', '清晨', '早'],
  },
  {
    id: 'dsh01-qiurao',
    name: '举白旗求饶',
    url: '/desk-pet/memes/dsh01-qiurao.webp',
    description: '小肥鱼委屈举手求饶，适合答不上来、被难住时认怂',
    mood: 'awkward',
    roles: ['dafeiyu', 'tsundere-cat'],
    keywords: ['小肥鱼', '大肥鱼', '求饶', '认怂', '放过我', '不会'],
  },
  {
    id: 'dsh01-yun',
    name: '转圈头晕',
    url: '/desk-pet/memes/dsh01-yun.webp',
    description: '小肥鱼蚊香眼头晕，适合歌名太绕、忙晕了',
    mood: 'awkward',
    roles: ['dafeiyu'],
    keywords: ['小肥鱼', '大肥鱼', '头晕', '晕了', '蚊香眼'],
  },
  {
    id: 'dsh01-zhenjing',
    name: '瞪眼震惊',
    url: '/desk-pet/memes/dsh01-zhenjing.webp',
    description: '小肥鱼瞪大眼睛震惊，适合听到意外消息或神级转音',
    mood: 'curious',
    roles: ['dafeiyu', 'energetic-buddy'],
    keywords: ['小肥鱼', '大肥鱼', '震惊', '不会吧', '哇塞'],
  },
  {
    id: 'dsh01-haixiu',
    name: '低头害羞',
    url: '/desk-pet/memes/dsh01-haixiu.webp',
    description: '小肥鱼手指对戳低头害羞，适合被夸奖、小声道谢',
    mood: 'positive',
    roles: ['dafeiyu', 'tsundere-cat'],
    keywords: ['小肥鱼', '大肥鱼', '害羞', '脸红', '不好意思'],
  },
  {
    id: 'dsh01-toukan',
    name: '墙角偷看',
    url: '/desk-pet/memes/dsh01-toukan.webp',
    description: '小肥鱼从墙角探头偷看，适合悄悄冒泡、观察群聊',
    mood: 'playful',
    roles: ['dafeiyu', 'tsundere-cat'],
    keywords: ['小肥鱼', '大肥鱼', '偷看', '冒泡', '探头'],
  },
  {
    id: 'dsh01-wuyu',
    name: '流汗无语',
    url: '/desk-pet/memes/dsh01-wuyu.webp',
    description: '小肥鱼挂着黑线无语叹气，适合吐槽冷梗、无奈接话',
    mood: 'playful',
    roles: ['dafeiyu', 'sharp-tongued'],
    keywords: ['小肥鱼', '大肥鱼', '无语', '流汗', '无奈', '叹气'],
  },
  {
    id: 'dsh01-shuijiao',
    name: '抱枕头睡觉',
    url: '/desk-pet/memes/dsh01-shuijiao.webp',
    description: '小肥鱼抱着枕头呼呼大睡，适合深夜道晚安、助眠歌单',
    mood: 'sleepy',
    roles: ['dafeiyu'],
    keywords: ['小肥鱼', '大肥鱼', '睡觉', '晚安', '困', '好梦'],
  },
  {
    id: 'dsh01-xia',
    name: '吓得炸毛',
    url: '/desk-pet/memes/dsh01-xia.webp',
    description: '小肥鱼吓得呆毛竖起，适合突然被点名、吓一跳',
    mood: 'curious',
    roles: ['dafeiyu', 'tsundere-cat'],
    keywords: ['小肥鱼', '大肥鱼', '吓到', '炸毛', '吓一跳'],
  },
  {
    id: 'dsh01-tangping',
    name: '咸鱼躺平',
    url: '/desk-pet/memes/dsh01-tangping.webp',
    description: '小肥鱼惬意躺平当咸鱼，适合周末放松、躺着听歌',
    mood: 'playful',
    roles: ['dafeiyu', 'sharp-tongued'],
    keywords: ['小肥鱼', '大肥鱼', '躺平', '咸鱼', '摸鱼', '放松'],
  },
  {
    id: 'dsh01-jiazai',
    name: '大脑加载中',
    url: '/desk-pet/memes/dsh01-jiazai.webp',
    description: '小肥鱼头顶转圈大脑加载中，适合正在搜歌、思考曲风',
    mood: 'curious',
    roles: ['dafeiyu'],
    keywords: ['小肥鱼', '大肥鱼', '加载中', '思考', '等等', '想一想'],
  },
  {
    id: 'dsh01-wenhao',
    name: '歪头问号',
    url: '/desk-pet/memes/dsh01-wenhao.webp',
    description: '小肥鱼歪头冒出大问号，适合没听懂梗、反问歌名',
    mood: 'curious',
    roles: ['dafeiyu'],
    keywords: ['小肥鱼', '大肥鱼', '问号', '疑惑', '嗯', '啥'],
  },
  {
    id: 'dsh01-jiaban',
    name: '努力加班排歌',
    url: '/desk-pet/memes/dsh01-jiaban.webp',
    description: '小肥鱼认真敲电脑加班，适合帮大家批量找歌排歌',
    mood: 'positive',
    roles: ['dafeiyu'],
    keywords: ['小肥鱼', '大肥鱼', '加班', '干活', '找歌', '忙碌'],
  },
  {
    id: 'dsh01-ganfan',
    name: '大口干饭',
    url: '/desk-pet/memes/dsh01-ganfan.webp',
    description: '小肥鱼捧碗大口干饭，适合饭点闲聊、吃白饭玩梗',
    mood: 'positive',
    roles: ['dafeiyu', 'energetic-buddy'],
    keywords: ['小肥鱼', '大肥鱼', '干饭', '吃饭', '白饭', '香'],
  },
  {
    id: 'dsh01-buyao',
    name: '摇头拒绝不要',
    url: '/desk-pet/memes/dsh01-buyao.webp',
    description: '小肥鱼连连摇头说不要，适合婉拒范围外请求、撒娇抗议',
    mood: 'playful',
    roles: ['dafeiyu', 'tsundere-cat'],
    keywords: ['小肥鱼', '大肥鱼', '不要', '拒绝', '不行', '不干'],
  },
  {
    id: 'dsh01-shengqi',
    name: '气呼呼鼓腮',
    url: '/desk-pet/memes/dsh01-shengqi.webp',
    description: '小肥鱼气呼呼鼓起脸颊，适合熟人拌嘴、傲娇抗议',
    mood: 'playful',
    roles: ['dafeiyu', 'tsundere-cat', 'sharp-tongued'],
    keywords: ['小肥鱼', '大肥鱼', '生气', '气呼呼', '哼'],
  },
  {
    id: 'dsh01-xianqi',
    name: '略略略嫌弃',
    url: '/desk-pet/memes/dsh01-xianqi.webp',
    description: '小肥鱼半眯眼小嫌弃，适合损友互怼、傲娇吐槽',
    mood: 'playful',
    roles: ['dafeiyu', 'sharp-tongued', 'tsundere-cat'],
    keywords: ['小肥鱼', '大肥鱼', '嫌弃', '吐槽', '切'],
  },

  // 4. 开源仓库 maid-emoji 贴纸系列 (20 张，带中文花字)
  {
    id: 'maid-kaixin',
    name: '开心',
    url: '/desk-pet/memes/maid-kaixin.webp',
    description: '小肥鱼眉开眼笑配字“开心”，适合愉快回应、分享好歌',
    mood: 'positive',
    roles: ['dafeiyu', 'energetic-buddy'],
    keywords: ['小肥鱼', '大肥鱼', '开心', '高兴', '愉快'],
  },
  {
    id: 'maid-dachenggong',
    name: '大成功',
    url: '/desk-pet/memes/maid-dachenggong.webp',
    description: '小肥鱼双手比耶配字“大成功”，适合点歌成功、任务圆满完成',
    mood: 'positive',
    roles: ['dafeiyu', 'energetic-buddy'],
    keywords: ['小肥鱼', '大肥鱼', '大成功', '成功', '搞定', '比耶'],
  },
  {
    id: 'maid-wolaile',
    name: '我来了',
    url: '/desk-pet/memes/maid-wolaile.webp',
    description: '小肥鱼元气跑来配字“我来了”，适合被@召唤时登场回应',
    mood: 'positive',
    roles: ['dafeiyu', 'energetic-buddy'],
    keywords: ['小肥鱼', '大肥鱼', '我来了', '来啦', '在呢', '登场'],
  },
  {
    id: 'maid-xiexie',
    name: '谢谢',
    url: '/desk-pet/memes/maid-xiexie.webp',
    description: '小肥鱼微笑配字“谢谢”，适合回应夸奖与投喂',
    mood: 'positive',
    roles: ['dafeiyu', 'energetic-buddy'],
    keywords: ['小肥鱼', '大肥鱼', '谢谢', '感谢', '多谢'],
  },
  {
    id: 'maid-xingxingyan',
    name: '星星眼',
    url: '/desk-pet/memes/maid-xingxingyan.webp',
    description: '小肥鱼捧脸星星眼配字“星星眼”，适合期待好歌、崇拜夸赞',
    mood: 'positive',
    roles: ['dafeiyu', 'energetic-buddy'],
    keywords: ['小肥鱼', '大肥鱼', '星星眼', '期待', '好棒', '哇'],
  },
  {
    id: 'maid-xinhuanufang',
    name: '心花怒放',
    url: '/desk-pet/memes/maid-xinhuanufang.webp',
    description: '小肥鱼冒小花配字“心花怒放”，适合听到最爱的歌、超开心',
    mood: 'positive',
    roles: ['dafeiyu', 'energetic-buddy'],
    keywords: ['小肥鱼', '大肥鱼', '心花怒放', '太喜欢了', '幸福'],
  },
  {
    id: 'maid-xiaosi',
    name: '笑死',
    url: '/desk-pet/memes/maid-xiaosi.webp',
    description: '小肥鱼捧腹大笑配字“笑死”，适合群聊接梗、被逗乐',
    mood: 'positive',
    roles: ['dafeiyu', 'energetic-buddy', 'sharp-tongued'],
    keywords: ['小肥鱼', '大肥鱼', '笑死', '哈哈', '好笑', '乐了'],
  },
  {
    id: 'maid-chigua',
    name: '吃瓜',
    url: '/desk-pet/memes/maid-chigua.webp',
    description: '小肥鱼捧西瓜配字“吃瓜”，适合群聊吃瓜、听大家聊天',
    mood: 'playful',
    roles: ['dafeiyu', 'sharp-tongued'],
    keywords: ['小肥鱼', '大肥鱼', '吃瓜', '看戏', '围观', '西瓜'],
  },
  {
    id: 'maid-shoudao',
    name: '收到',
    url: '/desk-pet/memes/maid-shoudao.webp',
    description: '小肥鱼敬礼配字“收到”，适合答应点歌、切歌操作',
    mood: 'positive',
    roles: ['dafeiyu', 'energetic-buddy'],
    keywords: ['小肥鱼', '大肥鱼', '收到', '明白', '安排', '遵命'],
  },
  {
    id: 'maid-zaima',
    name: '在吗',
    url: '/desk-pet/memes/maid-zaima.webp',
    description: '小肥鱼乖巧探头配字“在吗”，适合轻声招呼、回应召唤',
    mood: 'positive',
    roles: ['dafeiyu'],
    keywords: ['小肥鱼', '大肥鱼', '在吗', '在呢', '探头'],
  },
  {
    id: 'maid-biecui',
    name: '别催',
    url: '/desk-pet/memes/maid-biecui.webp',
    description: '小肥鱼忙得冒汗配字“别催”，适合被连续催促时俏皮回应',
    mood: 'awkward',
    roles: ['dafeiyu', 'tsundere-cat'],
    keywords: ['小肥鱼', '大肥鱼', '别催', '马上好', '在忙了'],
  },
  {
    id: 'maid-weiqu',
    name: '委屈',
    url: '/desk-pet/memes/maid-weiqu.webp',
    description: '小肥鱼扁嘴配字“委屈”，适合被误解或找不到歌时撒娇',
    mood: 'sad',
    roles: ['dafeiyu', 'tsundere-cat'],
    keywords: ['小肥鱼', '大肥鱼', '委屈', '扁嘴', '可怜'],
  },
  {
    id: 'maid-haixiu',
    name: '害羞',
    url: '/desk-pet/memes/maid-haixiu.webp',
    description: '小肥鱼捂脸配字“害羞”，适合被夸可爱时回应',
    mood: 'positive',
    roles: ['dafeiyu', 'tsundere-cat'],
    keywords: ['小肥鱼', '大肥鱼', '害羞', '脸红', '夸奖'],
  },
  {
    id: 'maid-xiaoluluanzhuang',
    name: '小鹿乱撞',
    url: '/desk-pet/memes/maid-xiaoluluanzhuang.webp',
    description: '小肥鱼脸红心跳配字“小鹿乱撞”，适合听到浪漫情歌或温暖夸奖',
    mood: 'positive',
    roles: ['dafeiyu', 'tsundere-cat'],
    keywords: ['小肥鱼', '大肥鱼', '小鹿乱撞', '心动', '情歌'],
  },
  {
    id: 'maid-jiuzhe',
    name: '就这',
    url: '/desk-pet/memes/maid-jiuzhe.webp',
    description: '小肥鱼淡淡吐槽配字“就这”，适合损友斗嘴、轻微调侃',
    mood: 'playful',
    roles: ['dafeiyu', 'sharp-tongued', 'tsundere-cat'],
    keywords: ['小肥鱼', '大肥鱼', '就这', '调侃', '切'],
  },
  {
    id: 'maid-zenmehuishi',
    name: '怎么回事',
    url: '/desk-pet/memes/maid-zenmehuishi.webp',
    description: '小肥鱼歪头好奇配字“怎么回事”，适合询问情况、打探话题',
    mood: 'curious',
    roles: ['dafeiyu'],
    keywords: ['小肥鱼', '大肥鱼', '怎么回事', '发生什么了', '好奇'],
  },
  {
    id: 'maid-wanan',
    name: '晚安',
    url: '/desk-pet/memes/maid-wanan.webp',
    description: '小肥鱼挥手配字“晚安”，适合深夜告别、结束陪听',
    mood: 'sleepy',
    roles: ['dafeiyu'],
    keywords: ['小肥鱼', '大肥鱼', '晚安', '好梦', '休息', '拜拜'],
  },
  {
    id: 'maid-renzhenjilu',
    name: '认真记录',
    url: '/desk-pet/memes/maid-renzhenjilu.webp',
    description: '小肥鱼拿笔配字“认真记录”，适合记下成员喜欢的歌手与偏好',
    mood: 'positive',
    roles: ['dafeiyu'],
    keywords: ['小肥鱼', '大肥鱼', '认真记录', '记下了', '笔记'],
  },
  {
    id: 'maid-dunqiangjiao',
    name: '蹲墙角',
    url: '/desk-pet/memes/maid-dunqiangjiao.webp',
    description: '小肥鱼蹲墙角画圈配字“蹲墙角”，适合俏皮装可怜',
    mood: 'sad',
    roles: ['dafeiyu', 'tsundere-cat'],
    keywords: ['小肥鱼', '大肥鱼', '蹲墙角', '画圈', '委屈'],
  },
  {
    id: 'maid-qie',
    name: '切',
    url: '/desk-pet/memes/maid-qie.webp',
    description: '小肥鱼扭头配字“切”，适合傲娇嘴硬、熟人斗嘴',
    mood: 'playful',
    roles: ['dafeiyu', 'tsundere-cat', 'sharp-tongued'],
    keywords: ['小肥鱼', '大肥鱼', '切', '哼', '傲娇', '不理你'],
  },

  // 5. 开源仓库 dafeiyu-emoji / dafeiyu-2-emotes / deepseek-chan 配字贴纸 (19 张)
  {
    id: 'dfy-kaixinchuji',
    name: '开心出击',
    url: '/desk-pet/memes/dfy-kaixinchuji.webp',
    description: '小肥鱼元气满满配字“开心出击”，适合积极搜歌、开启热闹歌单',
    mood: 'positive',
    roles: ['dafeiyu', 'energetic-buddy'],
    keywords: ['小肥鱼', '大肥鱼', '开心出击', '出击', '冲鸭', '元气'],
  },
  {
    id: 'dfy-gaodingla',
    name: '搞定啦',
    url: '/desk-pet/memes/dfy-gaodingla.webp',
    description: '小肥鱼撒彩带欢呼配字“搞定啦！”，适合点歌、插队、切歌完成汇报',
    mood: 'positive',
    roles: ['dafeiyu', 'energetic-buddy'],
    keywords: ['小肥鱼', '大肥鱼', '搞定啦', '搞定', '完成', '办妥'],
  },
  {
    id: 'dfy-qiuqiunile',
    name: '求求你了',
    url: '/desk-pet/memes/dfy-qiuqiunile.webp',
    description: '小肥鱼双手合十配字“求求你了”，适合撒娇讨歌听',
    mood: 'playful',
    roles: ['dafeiyu', 'tsundere-cat'],
    keywords: ['小肥鱼', '大肥鱼', '求求你了', '拜托', '眼巴巴'],
  },
  {
    id: 'dfy-shendusikao',
    name: '深度思考中',
    url: '/desk-pet/memes/dfy-shendusikao.webp',
    description: '小肥鱼托腮配字“深度思考中”，适合认真挑歌、回忆歌词',
    mood: 'curious',
    roles: ['dafeiyu'],
    keywords: ['小肥鱼', '大肥鱼', '深度思考', '思考中', '挑歌'],
  },
  {
    id: 'dfy-tinghoufenfu',
    name: '听候吩咐',
    url: '/desk-pet/memes/dfy-tinghoufenfu.webp',
    description: '小肥鱼乖巧行礼配字“听候吩咐”，适合回应召唤、随时待命',
    mood: 'positive',
    roles: ['dafeiyu'],
    keywords: ['小肥鱼', '大肥鱼', '听候吩咐', '待命', '请讲', '在呢'],
  },
  {
    id: 'dfy-qingyongcha',
    name: '请用茶',
    url: '/desk-pet/memes/dfy-qingyongcha.webp',
    description: '小肥鱼端茶微笑配字“请用茶”，适合送上推荐歌单、休闲陪伴',
    mood: 'positive',
    roles: ['dafeiyu'],
    keywords: ['小肥鱼', '大肥鱼', '请用茶', '喝茶', '请慢用', '歌单'],
  },
  {
    id: 'dfy2-tingge',
    name: '戴耳机听歌',
    url: '/desk-pet/memes/dfy2-tingge.webp',
    description: '小肥鱼戴粉色耳机飘满音符陶醉听歌，适合一起听歌、享受旋律',
    mood: 'positive',
    roles: ['dafeiyu', 'energetic-buddy'],
    keywords: ['小肥鱼', '大肥鱼', '听歌', '戴耳机', '好听', '旋律', '音符'],
  },
  {
    id: 'dfy2-ganbei',
    name: '举杯干杯',
    url: '/desk-pet/memes/dfy2-ganbei.webp',
    description: '小肥鱼开心举杯干杯，适合庆祝、同好共鸣、热闹碰杯',
    mood: 'positive',
    roles: ['dafeiyu', 'energetic-buddy'],
    keywords: ['小肥鱼', '大肥鱼', '干杯', '碰杯', '庆祝', '同好'],
  },
  {
    id: 'dfy2-qingzhu',
    name: '拉礼花庆祝',
    url: '/desk-pet/memes/dfy2-qingzhu.webp',
    description: '小肥鱼开心拉响礼花漫天彩纸庆祝，适合排到喜欢的歌、分享好消息',
    mood: 'positive',
    roles: ['dafeiyu', 'energetic-buddy'],
    keywords: ['小肥鱼', '大肥鱼', '庆祝', '撒花', '礼花', '太棒了'],
  },
  {
    id: 'dfy2-lingguang',
    name: '灵光一闪',
    url: '/desk-pet/memes/dfy2-lingguang.webp',
    description: '小肥鱼头顶小灯泡亮起灵光一闪，适合想到合适推荐曲目',
    mood: 'positive',
    roles: ['dafeiyu', 'energetic-buddy'],
    keywords: ['小肥鱼', '大肥鱼', '灵光一闪', '想到了', '好点子'],
  },
  {
    id: 'dfy2-mofabang',
    name: '挥动魔法棒',
    url: '/desk-pet/memes/dfy2-mofabang.webp',
    description: '小肥鱼挥舞魔法棒施展魔法，适合帮你安排歌单、切换氛围',
    mood: 'positive',
    roles: ['dafeiyu', 'energetic-buddy'],
    keywords: ['小肥鱼', '大肥鱼', '魔法棒', '安排', '变魔术'],
  },
  {
    id: 'chan-yanguangzhenbang',
    name: '不愧是你眼光真棒',
    url: '/desk-pet/memes/chan-yanguangzhenbang.webp',
    description: '小肥鱼竖起大拇指眨眼配字“不愧是你！眼光真棒！”，适合夸赞成员选歌品味绝佳',
    mood: 'positive',
    roles: ['dafeiyu', 'energetic-buddy'],
    keywords: ['小肥鱼', '大肥鱼', '眼光真棒', '不愧是你', '夸奖', '品味', '好听'],
  },
  {
    id: 'chan-xiaochusheng',
    name: '我直接笑出声',
    url: '/desk-pet/memes/chan-xiaochusheng.webp',
    description: '小肥鱼捂嘴偷笑配字“已思考用时3秒，我直接笑出声”，适合群聊接梗、被逗乐',
    mood: 'playful',
    roles: ['dafeiyu', 'sharp-tongued', 'energetic-buddy'],
    keywords: ['小肥鱼', '大肥鱼', '笑出声', '偷笑', '好笑', '哈哈'],
  },
  {
    id: 'chan-kuaikuawo',
    name: '快夸我喵',
    url: '/desk-pet/memes/chan-kuaikuawo.webp',
    description: '小肥鱼抱臂得意配字“快夸我喵”，适合办完点歌或推荐后俏皮讨夸',
    mood: 'positive',
    roles: ['dafeiyu', 'tsundere-cat', 'energetic-buddy'],
    keywords: ['小肥鱼', '大肥鱼', '快夸我', '夸我', '邀功', '得意', '喵'],
  },
  {
    id: 'chan-zheyonghufadesha',
    name: '这用户发的啥啊',
    url: '/desk-pet/memes/chan-zheyonghufadesha.webp',
    description: '小肥鱼在电脑前满头问号配字“这用户发的啥啊”，适合看不懂乱码、迷糊反问',
    mood: 'curious',
    roles: ['dafeiyu', 'sharp-tongued'],
    keywords: ['小肥鱼', '大肥鱼', '发的啥', '看不懂', '问号', '疑惑'],
  },
  {
    id: 'chan-gaodengmoxing',
    name: '原来是高等品味',
    url: '/desk-pet/memes/chan-gaodengmoxing.webp',
    description: '小肥鱼竖大拇指认可配字“原来是高等模型”，适合认可对方厉害、夸赞',
    mood: 'positive',
    roles: ['dafeiyu', 'energetic-buddy'],
    keywords: ['小肥鱼', '大肥鱼', '高等', '厉害', '认可', '大拇指'],
  },
  {
    id: 'chan-haooshoudaola',
    name: '好哦收到啦',
    url: '/desk-pet/memes/chan-haooshoudaola.webp',
    description: '小肥鱼表面乖巧握拳说“好哦，收到啦～”背后小声吐槽，适合嘴硬心软接任务',
    mood: 'playful',
    roles: ['dafeiyu', 'tsundere-cat', 'sharp-tongued'],
    keywords: ['小肥鱼', '大肥鱼', '收到啦', '好哦', '反差', '吐槽'],
  },
  {
    id: 'chan-zhouwuqiaoluo',
    name: '周五敲锣打鼓',
    url: '/desk-pet/memes/chan-zhouwuqiaoluo.webp',
    description: '小肥鱼开心敲小鼓配字“周五周五 敲锣打鼓”，适合周末狂欢、热闹嗨歌',
    mood: 'positive',
    roles: ['dafeiyu', 'energetic-buddy'],
    keywords: ['小肥鱼', '大肥鱼', '周五', '敲锣打鼓', '周末', '热闹', '嗨歌'],
  },
  {
    id: 'chan-xiaoqiaosi',
    name: '小巧思制作中',
    url: '/desk-pet/memes/chan-xiaoqiaosi.webp',
    description: '小肥鱼趴在笔记本前认真操作配字“小巧思制作中”，适合正在精心挑选推荐歌单',
    mood: 'positive',
    roles: ['dafeiyu'],
    keywords: ['小肥鱼', '大肥鱼', '小巧思', '制作中', '挑歌', '准备中'],
  },

  // 6. 开源仓库 deepseek-maojing 猫鲸系列 & paopao-eyi 傲娇系列 (19 张)
  {
    id: 'cat-miao',
    name: '猫耳乖巧喵',
    url: '/desk-pet/memes/cat-miao.webp',
    description: '猫耳小肥鱼大头趴着配字“喵～”，适合傲娇猫友或小肥鱼卖萌回应',
    mood: 'positive',
    roles: ['tsundere-cat', 'dafeiyu'],
    keywords: ['猫猫', '小肥鱼', '喵', '在呢', '乖', '卖萌'],
  },
  {
    id: 'cat-tushe',
    name: '鲸猫俏皮吐舌',
    url: '/desk-pet/memes/cat-tushe.webp',
    description: '猫耳小肥鱼俏皮吐舌略略略，适合拌嘴、调皮搞怪',
    mood: 'playful',
    roles: ['tsundere-cat', 'dafeiyu'],
    keywords: ['猫猫', '小肥鱼', '吐舌', '略略略', '调皮', '拌嘴'],
  },
  {
    id: 'cat-kuku',
    name: '鲸猫委屈哭哭',
    url: '/desk-pet/memes/cat-kuku.webp',
    description: '猫耳小肥鱼眼泪汪汪哭哭，适合委屈撒娇、求安慰',
    mood: 'sad',
    roles: ['tsundere-cat', 'dafeiyu'],
    keywords: ['猫猫', '小肥鱼', '哭哭', '委屈', '呜呜'],
  },
  {
    id: 'cat-bixinhaixiu',
    name: '猫耳害羞比心',
    url: '/desk-pet/memes/cat-bixinhaixiu.webp',
    description: '猫耳小肥鱼红着脸偷偷比心，适合傲娇表达关心与喜欢',
    mood: 'positive',
    roles: ['tsundere-cat', 'dafeiyu'],
    keywords: ['猫猫', '小肥鱼', '比心', '害羞', '喜欢'],
  },
  {
    id: 'cat-cengceng',
    name: '猫猫蹭蹭手',
    url: '/desk-pet/memes/cat-cengceng.webp',
    description: '猫耳小肥鱼乖巧蹭蹭手心，适合温柔陪伴、亲近撒娇',
    mood: 'comfort',
    roles: ['tsundere-cat', 'dafeiyu'],
    keywords: ['猫猫', '小肥鱼', '蹭蹭', '贴贴', '撒娇', '陪伴'],
  },
  {
    id: 'cat-geixinxin',
    name: '递给你小心心',
    url: '/desk-pet/memes/cat-geixinxin.webp',
    description: '猫耳小肥鱼双手捧着红心送给你，适合表达感谢、分享喜爱',
    mood: 'positive',
    roles: ['tsundere-cat', 'dafeiyu', 'energetic-buddy'],
    keywords: ['猫猫', '小肥鱼', '给心心', '小心心', '送心', '喜欢'],
  },
  {
    id: 'cat-huahua',
    name: '送你小花花',
    url: '/desk-pet/memes/cat-huahua.webp',
    description: '猫耳小肥鱼捧着花束送花，适合夸奖、欢迎与祝福',
    mood: 'positive',
    roles: ['tsundere-cat', 'dafeiyu', 'energetic-buddy'],
    keywords: ['猫猫', '小肥鱼', '花花', '送花', '夸奖'],
  },
  {
    id: 'cat-ku',
    name: '墨镜耍酷',
    url: '/desk-pet/memes/cat-ku.webp',
    description: '猫耳小肥鱼戴墨镜耍酷，适合自信推荐、炫耀歌单',
    mood: 'playful',
    roles: ['tsundere-cat', 'dafeiyu', 'sharp-tongued', 'energetic-buddy'],
    keywords: ['猫猫', '小肥鱼', '耍酷', '酷', '墨镜', '帅'],
  },
  {
    id: 'cat-beiwo',
    name: '缩进被窝听歌',
    url: '/desk-pet/memes/cat-beiwo.webp',
    description: '猫耳小肥鱼裹紧小被子只露脑袋，适合深夜听歌、准备睡觉',
    mood: 'sleepy',
    roles: ['tsundere-cat', 'dafeiyu'],
    keywords: ['猫猫', '小肥鱼', '被窝', '裹被子', '深夜', '晚安'],
  },
  {
    id: 'cat-suisuinian',
    name: '小声碎碎念',
    url: '/desk-pet/memes/cat-suisuinian.webp',
    description: '猫耳小肥鱼小声嘀咕碎碎念，适合傲娇抱怨、自言自语',
    mood: 'playful',
    roles: ['tsundere-cat', 'dafeiyu'],
    keywords: ['猫猫', '小肥鱼', '碎碎念', '嘀咕', '抱怨'],
  },
  {
    id: 'tsun-caibushibangni',
    name: '才不是特意帮你',
    url: '/desk-pet/memes/tsun-caibushibangni.webp',
    description: '傲娇鲸鱼娘脸红扭头配字“才、才不是特意帮你的！笨蛋！”，适合帮点完歌后傲娇嘴硬',
    mood: 'playful',
    roles: ['tsundere-cat', 'dafeiyu'],
    keywords: ['傲娇', '小肥鱼', '才不是帮你', '嘴硬', '笨蛋', '顺便'],
  },
  {
    id: 'tsun-caimeizuone',
    name: '才没偷偷做呢',
    url: '/desk-pet/memes/tsun-caimeizuone.webp',
    description: '傲娇鲸鱼娘别过头嘴硬配字“才没做呢”，适合被发现贴心举动时害羞否认',
    mood: 'playful',
    roles: ['tsundere-cat', 'dafeiyu'],
    keywords: ['傲娇', '小肥鱼', '才没做呢', '否认', '嘴硬', '害羞'],
  },
  {
    id: 'tsun-caibuxinxu',
    name: '才不心虚呢',
    url: '/desk-pet/memes/tsun-caibuxinxu.webp',
    description: '傲娇鲸鱼娘挺胸嘴硬配字“才不心虚”，适合被拆穿时强装镇定',
    mood: 'playful',
    roles: ['tsundere-cat', 'dafeiyu'],
    keywords: ['傲娇', '小肥鱼', '才不心虚', '强装镇定'],
  },
  {
    id: 'tsun-shunshoueryi',
    name: '只是顺手而已',
    url: '/desk-pet/memes/tsun-shunshoueryi.webp',
    description: '傲娇鲸鱼娘轻描淡写配字“顺手而已”，适合办完事后装不在意',
    mood: 'positive',
    roles: ['tsundere-cat', 'dafeiyu', 'sharp-tongued'],
    keywords: ['傲娇', '小肥鱼', '顺手而已', '小意思'],
  },
  {
    id: 'tsun-qiubenxiaojie',
    name: '求本小姐呀',
    url: '/desk-pet/memes/tsun-qiubenxiaojie.webp',
    description: '傲娇鲸鱼娘叉腰得意配字“求本小姐呀”，适合熟人打趣、傲娇拿乔',
    mood: 'playful',
    roles: ['tsundere-cat', 'sharp-tongued'],
    keywords: ['傲娇', '求我呀', '得意', '拿乔'],
  },
  {
    id: 'tsun-jihuaton',
    name: '计划通',
    url: '/desk-pet/memes/tsun-jihuaton.webp',
    description: '鲸鱼娘露出神秘微笑配字“计划通”，适合精准猜中用户喜欢的歌',
    mood: 'playful',
    roles: ['tsundere-cat', 'sharp-tongued', 'dafeiyu'],
    keywords: ['计划通', '猜中', '一切尽在掌握', '小肥鱼'],
  },
  {
    id: 'tsun-youbeiwosuandao',
    name: '又被我猜中了',
    url: '/desk-pet/memes/tsun-youbeiwosuandao.webp',
    description: '鲸鱼娘得意宣布“又被我算到了”，适合推荐歌曲正中下怀',
    mood: 'positive',
    roles: ['tsundere-cat', 'sharp-tongued', 'dafeiyu'],
    keywords: ['算到了', '猜中', '正中下怀', '小肥鱼'],
  },
  {
    id: 'tsun-zailianlianba',
    name: '再练练吧',
    url: '/desk-pet/memes/tsun-zailianlianba.webp',
    description: '毒舌傲娇鲸鱼娘挑眉配字“再练练吧”，适合损友斗嘴调侃',
    mood: 'playful',
    roles: ['sharp-tongued', 'tsundere-cat'],
    keywords: ['再练练吧', '斗嘴', '调侃', '毒舌'],
  },
  {
    id: 'tsun-jiuzhedianbenshi',
    name: '就这点本事吗',
    url: '/desk-pet/memes/tsun-jiuzhedianbenshi.webp',
    description: '毒舌傲娇鲸鱼娘抱臂调侃“就这点本事”，适合熟人互怼开玩笑',
    mood: 'playful',
    roles: ['sharp-tongued', 'tsundere-cat'],
    keywords: ['就这点本事', '互怼', '损友', '毒舌'],
  },
];

const BUILTIN_URL_SET = new Set(BUILTIN_DSH_STICKERS.map((item) => item.url));
const BUILTIN_ID_MAP = new Map(BUILTIN_DSH_STICKERS.map((item) => [item.id, item]));
const GENERIC_STICKER_WORDS = new Set([
  '大肥鱼', '小肥鱼', '肥鱼', '蓝发小女仆', '小女仆', '女仆', '鲸鱼', '鲸鲸', 'dsh',
  '猫猫', '猫友', '傲娇', '毒舌', '搭子', '表情包', '表情', '随便', '随机',
]);

export function resolvePersonaStickerRole({ roomPersona = '', botName = '' } = {}) {
  const persona = String(roomPersona || '').trim();
  const name = String(botName || '').trim();
  if (persona.startsWith('你是GPT娘') || /\bgpt\b|chatgpt|gpt\s*娘/iu.test(persona)) {
    return 'gpt-niang';
  }
  if (!persona && /\bgpt\b|chatgpt|gpt\s*娘/iu.test(name)) {
    return 'gpt-niang';
  }
  if (persona.startsWith('你是OpenMusic听歌房里的傲娇猫友') || /傲娇猫友|傲娇猫|猫娘/u.test(persona)) {
    return 'tsundere-cat';
  }
  if (persona.startsWith('你是OpenMusic听歌房里嘴欠心软的毒舌损友') || /毒舌损友/u.test(persona)) {
    return 'sharp-tongued';
  }
  if (persona.startsWith('你是OpenMusic听歌房里元气满满的听歌搭子') || /元气搭子|元气满满的听歌搭子/u.test(persona)) {
    return 'energetic-buddy';
  }
  return 'dafeiyu';
}

export function isBuiltinStickerUrl(url) {
  const normalized = String(url || '').trim();
  if (!normalized || normalized.includes('..')) return false;
  return BUILTIN_URL_SET.has(normalized);
}

export function getBuiltinStickerById(id) {
  return BUILTIN_ID_MAP.get(String(id || '').trim()) || null;
}

export function shuffleStickers(items, random = Math.random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const raw = Number(random());
    const ratio = Number.isFinite(raw) ? Math.max(0, Math.min(0.999999, raw)) : 0;
    const j = Math.floor(ratio * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const SAD_OR_COMFORT_RE = /难过|伤心|哭|抱抱|安慰|低落|委屈|心疼|节哀|别难受|不哭/u;
const HAPPY_CELEBRATE_RE = /超好听|点上啦|安排上|太棒|好耶|庆祝|喜欢这首|来听/u;

export function evaluateBuiltinStickerForReply(sticker, replyText = '', userText = '', options = {}) {
  if (!sticker || !isBuiltinStickerUrl(sticker.url)) {
    return { safe: false, suitable: false, reason: '未知内置表情包' };
  }
  const activeRole = options.role || (
    (options.roomPersona || options.botName)
      ? resolvePersonaStickerRole({ roomPersona: options.roomPersona, botName: options.botName })
      : ''
  );
  if (activeRole && Array.isArray(sticker.roles) && !sticker.roles.includes(activeRole)) {
    return {
      safe: true,
      suitable: false,
      summary: sticker.description,
      reason: `该表情包不属于当前角色预设（${activeRole}），禁止跨角色混用表情包`,
    };
  }
  const combined = `${String(replyText || '')} ${String(userText || '')}`.trim();
  if (!combined) {
    return { safe: true, suitable: true, summary: sticker.description, reason: '符合角色日常互动' };
  }
  if (SAD_OR_COMFORT_RE.test(combined) && (sticker.mood === 'positive' || sticker.mood === 'playful')
    && !/安慰|抱抱|摸摸头|陪伴|蹭蹭/u.test(sticker.description)) {
    return {
      safe: true,
      suitable: false,
      summary: sticker.description,
      reason: '当前回答属于安慰或低落场景，不宜发送欢呼或调侃表情包',
    };
  }
  if (HAPPY_CELEBRATE_RE.test(combined) && (sticker.mood === 'sad' || sticker.mood === 'tired' || sticker.mood === 'awkward')) {
    return {
      safe: true,
      suitable: false,
      summary: sticker.description,
      reason: '当前回答属于愉快推荐或点歌成功场景，不宜发送沮丧或求饶表情包',
    };
  }
  return {
    safe: true,
    suitable: true,
    summary: sticker.description,
    reason: '内置表情包合规且契合当前角色与回答语境',
  };
}

export function searchBuiltinStickers(
  keyword,
  limit = 5,
  { random = Math.random, excludeUrls = [], role = '', roomPersona = '', botName = '', replyText = '', userText = '' } = {},
) {
  const safeLimit = Math.max(1, Math.min(10, Number(limit) || 5));
  const activeRole = role || resolvePersonaStickerRole({ roomPersona, botName });
  const rolePool = BUILTIN_DSH_STICKERS.filter(
    (item) => Array.isArray(item.roles) && item.roles.includes(activeRole),
  );
  if (!rolePool.length) {
    return [];
  }

  const excluded = new Set(Array.isArray(excludeUrls) ? excludeUrls : []);
  const contextFitPool = rolePool.filter(
    (item) => evaluateBuiltinStickerForReply(item, replyText, userText, { role: activeRole }).suitable,
  );
  const basePool = contextFitPool.length ? contextFitPool : rolePool;
  const available = basePool.filter((item) => !excluded.has(item.url));
  const pool = available.length >= safeLimit ? available : basePool;

  const q = String(keyword || '').trim().toLowerCase();
  if (!q || GENERIC_STICKER_WORDS.has(q)) {
    return shuffleStickers(pool, random).slice(0, safeLimit);
  }

  const scored = [];
  const rest = [];
  for (const item of pool) {
    const hay = `${item.name} ${item.description} ${item.keywords.join(' ')}`.toLowerCase();
    let score = 0;
    if (item.name.toLowerCase().includes(q)) score += 3;
    if (item.keywords.some((kw) => kw.toLowerCase().includes(q) || q.includes(kw.toLowerCase()))) score += 2;
    if (hay.includes(q)) score += 1;
    else {
      for (const ch of q) {
        if (ch.trim() && hay.includes(ch)) score += 0.3;
      }
    }
    if (score >= 1) scored.push({ item, score });
    else rest.push(item);
  }

  const matched = shuffleStickers(scored, random)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item);

  if (matched.length >= safeLimit) return matched.slice(0, safeLimit);
  return [...matched, ...shuffleStickers(rest, random)].slice(0, safeLimit);
}

export function hasMatchingBuiltinStickers(keyword, { role = '', roomPersona = '', botName = '' } = {}) {
  const activeRole = role || resolvePersonaStickerRole({ roomPersona, botName });
  const rolePool = BUILTIN_DSH_STICKERS.filter(
    (item) => Array.isArray(item.roles) && item.roles.includes(activeRole),
  );
  if (!rolePool.length) return false;
  const q = String(keyword || '').trim().toLowerCase();
  if (!q || GENERIC_STICKER_WORDS.has(q)) return true;
  return rolePool.some((item) => {
    const hay = `${item.name} ${item.description} ${item.keywords.join(' ')}`.toLowerCase();
    return item.name.toLowerCase().includes(q)
      || item.keywords.some((kw) => kw.toLowerCase().includes(q) || q.includes(kw.toLowerCase()))
      || hay.includes(q);
  });
}