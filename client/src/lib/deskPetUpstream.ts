// 由 scripts/sync-desk-pet-upstream.mjs 从固定提交的源码提取，请勿手改
export const UPSTREAM_ANIM = {
  "idle": [
    "待机呼吸休闲"
  ],
  "move": [
    "原地漂浮踏步",
    "螃蟹走路",
    "原地左转奔跑"
  ],
  "drag": [
    "被鼠标拖拽悬空反馈"
  ],
  "clicks": [
    "点击回应-开心跃动",
    "点击回应-害羞惊讶",
    "点击回应-傲娇生气",
    "点击回应-挠痒咯咯笑",
    "点击回应-元气挥手"
  ],
  "feed": [
    "吃白饭",
    "吃Token",
    "大口吃零食"
  ],
  "sleep": [
    "原地小憩沉眠"
  ],
  "sad": [
    "工作状态-垂头叹气冒汗"
  ],
  "happy": [
    "工作状态-雀跃庆祝"
  ],
  "work": [
    "写代码",
    "工作状态-思考冒泡",
    "工作状态-忙碌点按",
    "工作状态-清点归档"
  ],
  "money": [
    "余额-数金皱眉",
    "余额-钱袋满溢"
  ]
} as const;

export const UPSTREAM_CHARS = {
  "v1": {
    "label": "大肥鱼v1",
    "kind": "video"
  },
  "v2": {
    "label": "大肥鱼v2",
    "kind": "pose",
    "dir": "../assets/fish2/",
    "idle": [
      "DSniang1",
      "half_closed_eyes"
    ],
    "map": {
      "待机呼吸休闲": "DSniang1",
      "原地漂浮踏步": "DSniang1",
      "螃蟹走路": "DSniang1",
      "原地左转奔跑": "DSniang1",
      "原地小憩沉眠": "close_eyes",
      "工作状态-垂头叹气冒汗": "sad",
      "工作状态-雀跃庆祝": "cheer",
      "被鼠标拖拽悬空反馈": "scared",
      "写代码": "ok",
      "工作状态-思考冒泡": "half_closed_eyes",
      "工作状态-忙碌点按": "ok",
      "工作状态-清点归档": "quiet",
      "吃白饭": "fatfish",
      "吃Token": "fatfish",
      "大口吃零食": "fatfish",
      "点击回应-开心跃动": "cheer",
      "点击回应-害羞惊讶": "shy",
      "点击回应-傲娇生气": "angry",
      "点击回应-挠痒咯咯笑": "mock",
      "点击回应-元气挥手": "greet",
      "余额-数金皱眉": "disappointed",
      "余额-钱袋满溢": "thumbsup",
      "是啊，吃什么": "what",
      "深度思考碎碎念": "quiet"
    },
    "fallback": [
      "cheer",
      "greet",
      "shy",
      "mock",
      "stroking",
      "thumbsup",
      "what",
      "ok",
      "exhausted",
      "fatfish"
    ],
    "actions": [
      [
        "DSniang1",
        "打个招呼"
      ],
      [
        "greet",
        "挥手"
      ],
      [
        "cheer",
        "加油"
      ],
      [
        "shy",
        "害羞"
      ],
      [
        "mock",
        "得瑟"
      ],
      [
        "thumbsup",
        "点赞"
      ],
      [
        "ok",
        "比个 OK"
      ],
      [
        "quiet",
        "嘘"
      ],
      [
        "close_eyes",
        "闭眼休息"
      ],
      [
        "half_closed_eyes",
        "眯眼"
      ],
      [
        "exhausted",
        "累瘫"
      ],
      [
        "sad",
        "难过"
      ],
      [
        "disappointed",
        "失落"
      ],
      [
        "scared",
        "吓一跳"
      ],
      [
        "stroking",
        "摸摸头"
      ],
      [
        "what",
        "疑惑"
      ],
      [
        "angry",
        "生气"
      ],
      [
        "fatfish",
        "吃胖了"
      ]
    ]
  },
  "v3": {
    "label": "大肥鱼v3",
    "kind": "pose",
    "dir": "../assets/fish3/",
    "idle": [
      "DSniang1",
      "bored"
    ],
    "map": {
      "待机呼吸休闲": "DSniang1",
      "原地漂浮踏步": "DSniang1",
      "螃蟹走路": "DSniang1",
      "原地左转奔跑": "DSniang1",
      "原地小憩沉眠": "close_eyes",
      "工作状态-垂头叹气冒汗": "wronged",
      "工作状态-雀跃庆祝": "superhappy",
      "被鼠标拖拽悬空反馈": "shocked",
      "写代码": "ok",
      "工作状态-思考冒泡": "dazed",
      "工作状态-忙碌点按": "know",
      "工作状态-清点归档": "thumbsup",
      "吃白饭": "give",
      "吃Token": "give",
      "大口吃零食": "happy",
      "点击回应-开心跃动": "happy",
      "点击回应-害羞惊讶": "shy",
      "点击回应-傲娇生气": "angry",
      "点击回应-挠痒咯咯笑": "fakelaugh",
      "点击回应-元气挥手": "superhappy",
      "余额-数金皱眉": "disappointed",
      "余额-钱袋满溢": "money",
      "是啊，吃什么": "question",
      "深度思考碎碎念": "dazed"
    },
    "fallback": [
      "superhappy",
      "happy",
      "money",
      "proud",
      "wicked",
      "shy",
      "thumbsup",
      "give",
      "fakelaugh",
      "loud"
    ],
    "actions": [
      [
        "DSniang1",
        "打个招呼"
      ],
      [
        "amazing",
        "惊叹"
      ],
      [
        "astonish",
        "震惊"
      ],
      [
        "angry",
        "生气"
      ],
      [
        "bored",
        "无聊"
      ],
      [
        "caught",
        "被抓包"
      ],
      [
        "close_eyes",
        "闭眼休息"
      ],
      [
        "cornerfish",
        "缩墙角"
      ],
      [
        "dazed",
        "发懵"
      ],
      [
        "disappointed",
        "失落"
      ],
      [
        "exhausted",
        "累瘫"
      ],
      [
        "fakelaugh",
        "假笑"
      ],
      [
        "give",
        "送你"
      ],
      [
        "gotcha",
        "得手了"
      ],
      [
        "grit",
        "咬牙"
      ],
      [
        "half_closed_eyes",
        "眯眼"
      ],
      [
        "happy",
        "开心"
      ],
      [
        "know",
        "懂了"
      ],
      [
        "loud",
        "大喊"
      ],
      [
        "money",
        "数钱"
      ],
      [
        "ok",
        "比个 OK"
      ],
      [
        "paymore",
        "得加钱"
      ],
      [
        "proud",
        "得意"
      ],
      [
        "question",
        "疑问"
      ],
      [
        "shocked",
        "吓到"
      ],
      [
        "shy",
        "害羞"
      ],
      [
        "sotaku",
        "慌乱"
      ],
      [
        "superhappy",
        "超开心"
      ],
      [
        "thumbsup",
        "点赞"
      ],
      [
        "what2",
        "疑惑"
      ],
      [
        "wicked",
        "使坏"
      ],
      [
        "wronged",
        "委屈"
      ]
    ]
  },
  "v4": {
    "label": "大肥鱼v4",
    "kind": "pose",
    "dir": "../assets/fish4/",
    "idle": [
      "sleepy",
      "stretch"
    ],
    "map": {
      "待机呼吸休闲": "DSniang1",
      "原地漂浮踏步": "DSniang1",
      "螃蟹走路": "DSniang1",
      "原地左转奔跑": "DSniang1",
      "原地小憩沉眠": "sleepy",
      "工作状态-垂头叹气冒汗": "cry",
      "工作状态-雀跃庆祝": "cheer",
      "被鼠标拖拽悬空反馈": "dame",
      "写代码": "study",
      "工作状态-思考冒泡": "hm",
      "工作状态-忙碌点按": "youwrite",
      "工作状态-清点归档": "reflect",
      "吃白饭": "cake",
      "吃Token": "candy",
      "大口吃零食": "tea",
      "点击回应-开心跃动": "cheer",
      "点击回应-害羞惊讶": "shy",
      "点击回应-傲娇生气": "hip",
      "点击回应-挠痒咯咯笑": "peek",
      "点击回应-元气挥手": "greet",
      "余额-数金皱眉": "poorfish",
      "余额-钱袋满溢": "good",
      "是啊，吃什么": "hm",
      "深度思考碎碎念": "insight"
    },
    "fallback": [
      "good",
      "heart",
      "cheer",
      "hip",
      "peek",
      "stretch",
      "wake",
      "run",
      "grace",
      "wipe"
    ],
    "actions": [
      [
        "DSniang1",
        "打个招呼"
      ],
      [
        "cake",
        "吃蛋糕"
      ],
      [
        "candy",
        "吃糖"
      ],
      [
        "caught",
        "被抓包"
      ],
      [
        "cheer",
        "加油"
      ],
      [
        "close_eyes",
        "闭眼休息"
      ],
      [
        "cry",
        "大哭"
      ],
      [
        "dame",
        "不行"
      ],
      [
        "evidence",
        "有证据"
      ],
      [
        "good",
        "好耶"
      ],
      [
        "grace",
        "优雅"
      ],
      [
        "greet",
        "挥手"
      ],
      [
        "half_closed_eyes",
        "眯眼"
      ],
      [
        "heart",
        "比心"
      ],
      [
        "hip",
        "叉腰"
      ],
      [
        "hit",
        "被敲头"
      ],
      [
        "hm",
        "嗯…"
      ],
      [
        "insight",
        "顿悟"
      ],
      [
        "peek",
        "偷看"
      ],
      [
        "poorfish",
        "穷鱼"
      ],
      [
        "ready",
        "准备好了"
      ],
      [
        "reflect",
        "反省"
      ],
      [
        "run",
        "跑路"
      ],
      [
        "shy",
        "害羞"
      ],
      [
        "sleepy",
        "困了"
      ],
      [
        "stretch",
        "伸懒腰"
      ],
      [
        "study",
        "学习"
      ],
      [
        "tea",
        "喝茶"
      ],
      [
        "wall",
        "撞墙"
      ],
      [
        "wipe",
        "擦眼泪"
      ],
      [
        "youwrite",
        "你写"
      ],
      [
        "wake",
        "醒来"
      ]
    ]
  },
  "v5": {
    "label": "大肥鱼v5",
    "kind": "pose",
    "dir": "../assets/fish5/",
    "idle": [
      "DSniang1",
      "half_closed_eyes"
    ],
    "map": {
      "待机呼吸休闲": "DSniang1",
      "原地漂浮踏步": "DSniang1",
      "螃蟹走路": "DSniang1",
      "原地左转奔跑": "DSniang1",
      "原地小憩沉眠": "sleep",
      "工作状态-垂头叹气冒汗": "nooo",
      "工作状态-雀跃庆祝": "dancing",
      "被鼠标拖拽悬空反馈": "tremble",
      "写代码": "workhard",
      "工作状态-思考冒泡": "thinking",
      "工作状态-忙碌点按": "slacking",
      "工作状态-清点归档": "reading",
      "吃白饭": "noodles",
      "吃Token": "boba",
      "大口吃零食": "icecream",
      "点击回应-开心跃动": "dancing",
      "点击回应-害羞惊讶": "snowman",
      "点击回应-傲娇生气": "nooo",
      "点击回应-挠痒咯咯笑": "boba",
      "点击回应-元气挥手": "workhard",
      "余额-数金皱眉": "thinking",
      "余额-钱袋满溢": "dancing",
      "是啊，吃什么": "noodles",
      "深度思考碎碎念": "thinking"
    },
    "fallback": [
      "dancing",
      "guitar",
      "gaming",
      "boba",
      "icecream",
      "snowman",
      "reading",
      "slacking"
    ],
    "actions": [
      [
        "DSniang1",
        "打个招呼"
      ],
      [
        "half_closed_eyes",
        "眯眼发呆"
      ],
      [
        "sleep",
        "睡着了"
      ],
      [
        "slacking",
        "趴桌摸鱼"
      ],
      [
        "workhard",
        "打工中"
      ],
      [
        "thinking",
        "托腮思考"
      ],
      [
        "reading",
        "看书"
      ],
      [
        "gaming",
        "打游戏"
      ],
      [
        "dancing",
        "转圈舞"
      ],
      [
        "guitar",
        "弹吉他"
      ],
      [
        "boba",
        "喝奶茶"
      ],
      [
        "icecream",
        "吃冰淇淋"
      ],
      [
        "noodles",
        "嗦面"
      ],
      [
        "snowman",
        "堆雪人"
      ],
      [
        "nooo",
        "大哭"
      ],
      [
        "tremble",
        "瑟瑟发抖"
      ]
    ]
  },
  "v6": {
    "label": "大肥鱼v6",
    "kind": "pose",
    "dir": "../assets/fish6/",
    "idle": [
      "DSniang1"
    ],
    "map": {
      "待机呼吸休闲": "DSniang1",
      "原地漂浮踏步": "DSniang1",
      "螃蟹走路": "DSniang1",
      "原地左转奔跑": "DSniang1",
      "原地小憩沉眠": "DSniang1",
      "工作状态-垂头叹气冒汗": "DSniang1",
      "工作状态-雀跃庆祝": "rua",
      "被鼠标拖拽悬空反馈": "DSniang1",
      "写代码": "DSniang1",
      "工作状态-思考冒泡": "DSniang1",
      "工作状态-忙碌点按": "rua",
      "工作状态-清点归档": "DSniang1",
      "吃白饭": "DSniang1",
      "吃Token": "DSniang1",
      "大口吃零食": "DSniang1",
      "点击回应-开心跃动": "rua",
      "点击回应-害羞惊讶": "DSniang1",
      "点击回应-傲娇生气": "DSniang1",
      "点击回应-挠痒咯咯笑": "rua",
      "点击回应-元气挥手": "DSniang1",
      "余额-数金皱眉": "DSniang1",
      "余额-钱袋满溢": "rua",
      "是啊，吃什么": "DSniang1",
      "深度思考碎碎念": "DSniang1"
    },
    "fallback": [
      "rua",
      "DSniang1"
    ],
    "actions": [
      [
        "rua",
        "摸摸头"
      ]
    ]
  },
  "gpt": {
    "label": "GPT 娘",
    "kind": "sprite",
    "dsh": false,
    "dir": "../assets/gpt/",
    "actions": [
      [
        "idle",
        "待机眨眼"
      ],
      [
        "waving",
        "挥手打招呼"
      ],
      [
        "jumping",
        "悬停招手"
      ],
      [
        "work",
        "敲键盘"
      ],
      [
        "review",
        "拍手庆祝"
      ],
      [
        "waiting",
        "歪头等待"
      ],
      [
        "failed",
        "低头鼓劲"
      ],
      [
        "runRight",
        "向右奔跑"
      ],
      [
        "runLeft",
        "向左奔跑"
      ]
    ]
  }
} as const;

export const UPSTREAM_SPRITE = {
  "sheet": "../assets/gpt/spritesheet.webp",
  "cellW": 192,
  "cellH": 208,
  "cols": 8,
  "rows": 11,
  "sequences": {
    "idle": {
      "row": 0,
      "count": 6,
      "times": [
        1680,
        660,
        660,
        840,
        840,
        1920
      ]
    },
    "runRight": {
      "row": 1,
      "count": 8,
      "times": [
        120,
        120,
        120,
        120,
        120,
        120,
        120,
        220
      ]
    },
    "runLeft": {
      "row": 2,
      "count": 8,
      "times": [
        120,
        120,
        120,
        120,
        120,
        120,
        120,
        220
      ]
    },
    "waving": {
      "row": 3,
      "count": 4,
      "times": [
        140,
        140,
        140,
        280
      ]
    },
    "jumping": {
      "row": 4,
      "count": 5,
      "times": [
        140,
        140,
        140,
        140,
        280
      ]
    },
    "failed": {
      "row": 5,
      "count": 8,
      "times": [
        140,
        140,
        140,
        140,
        140,
        140,
        140,
        240
      ]
    },
    "waiting": {
      "row": 6,
      "count": 6,
      "times": [
        150,
        150,
        150,
        150,
        150,
        260
      ]
    },
    "work": {
      "row": 7,
      "count": 6,
      "times": [
        120,
        120,
        120,
        120,
        120,
        220
      ]
    },
    "review": {
      "row": 8,
      "count": 6,
      "times": [
        150,
        150,
        150,
        150,
        150,
        280
      ]
    },
    "sleep": {
      "row": 0,
      "count": 1,
      "times": [
        1200
      ],
      "frame": 2
    }
  }
} as const;

export const UPSTREAM_SPRITE_MAP = {
  "待机呼吸休闲": "idle",
  "原地漂浮踏步": "run",
  "螃蟹走路": "run",
  "原地左转奔跑": "run",
  "被鼠标拖拽悬空反馈": "jumping",
  "原地小憩沉眠": "sleep",
  "工作状态-垂头叹气冒汗": "failed",
  "工作状态-雀跃庆祝": "review",
  "写代码": "work",
  "工作状态-思考冒泡": "waiting",
  "工作状态-忙碌点按": "work",
  "工作状态-清点归档": "work",
  "吃白饭": "review",
  "吃Token": "review",
  "大口吃零食": "review",
  "点击回应-开心跃动": "review",
  "点击回应-害羞惊讶": "jumping",
  "点击回应-傲娇生气": "failed",
  "点击回应-挠痒咯咯笑": "waving",
  "点击回应-元气挥手": "waving",
  "余额-数金皱眉": "waiting",
  "余额-钱袋满溢": "review",
  "是啊，吃什么": "waiting",
  "深度思考碎碎念": "waiting"
} as const;

export const UPSTREAM_ACTIONS = [
  {
    "weight": 20,
    "id": "small",
    "pool": [
      "悠闲哼歌",
      "超大伸懒腰",
      "原地敲击桌面互动",
      "原地重力下蹲压缩",
      "哈欠连天",
      "女仆屈膝礼仪",
      "被吓一跳",
      "小幅度原地360度旋转展示",
      "偷吃零食被抓住",
      "用鲸鱼尾巴拍打地面",
      "打瞌睡被惊醒",
      "照镜子",
      "整体换装试色",
      "轻快记录",
      "摇扇纳凉",
      "晨间刷牙",
      "东张西望",
      "工作状态-原地踱步张望"
    ]
  },
  {
    "weight": 20,
    "id": "play",
    "pool": [
      "原地专心玩魔方",
      "原地蹲下玩玩具汽车",
      "鲸鱼吐泡泡特效",
      "原地跳跃抓碎头顶物品",
      "玩游戏气急败坏",
      "玩水枪",
      "小提琴演奏",
      "蓝鲸现世",
      "优雅女仆舞",
      "轻快摇摆舞",
      "可爱宅舞",
      "吹气球",
      "动物环绕",
      "放风筝",
      "拆礼物",
      "变鸽子",
      "扑克魔术",
      "抽陀螺",
      "吹笛子",
      "蝴蝶蜜蜂环绕头顶开花",
      "撸猫",
      "凭空生花",
      "骑木马",
      "三球抛接",
      "踢毽子",
      "下五子棋",
      "荡秋千"
    ]
  },
  {
    "weight": 16,
    "id": "eat",
    "pool": [
      "吃早餐",
      "吃午餐",
      "吃晚餐",
      "吃冰淇淋融化",
      "吃大闸蟹",
      "吃糖葫芦",
      "吃长寿面",
      "吃西瓜",
      "涮火锅"
    ]
  },
  {
    "weight": 14,
    "id": "season",
    "pool": [
      "被落叶淹没",
      "中秋赏月吃月饼",
      "堆雪人",
      "放烟花",
      "吃粽子",
      "吃年糕",
      "吃青团",
      "吃腊八粥",
      "吃重阳糕",
      "收红包",
      "写福字",
      "穿针乞巧",
      "舞狮头",
      "讨糖南瓜灯",
      "插茱萸赏菊",
      "放河灯",
      "萌化小幽灵",
      "装点圣诞树",
      "放孔明灯",
      "吃汤圆",
      "吃饺子"
    ]
  },
  {
    "weight": 10,
    "id": "text",
    "pool": [
      "是啊，吃什么",
      "深度思考碎碎念"
    ]
  }
] as const;

export const UPSTREAM_WHISPERS = [
  "碎碎念-擦桌碎碎念",
  "碎碎念-发呆碎碎念",
  "碎碎念-对屏碎碎念"
] as const;

export const UPSTREAM_NO_MIRROR = [
  "是啊，吃什么",
  "深度思考碎碎念"
] as const;

export const UPSTREAM_VIDEO_NAMES = [
  "三球抛接",
  "下五子棋",
  "东张西望",
  "中秋赏月吃月饼",
  "优雅女仆舞",
  "余额-分文不剩",
  "余额-数金皱眉",
  "余额-袋空如洗",
  "余额-金袋叮当",
  "余额-钱袋如常",
  "余额-钱袋满溢",
  "偷吃零食被抓住",
  "写代码",
  "写福字",
  "凭空生花",
  "动物环绕",
  "原地专心玩魔方",
  "原地小憩沉眠",
  "原地左转奔跑",
  "原地敲击桌面互动",
  "原地漂浮踏步",
  "原地跳跃抓碎头顶物品",
  "原地蹲下玩玩具汽车",
  "原地重力下蹲压缩",
  "变鸽子",
  "可爱宅舞",
  "吃Token",
  "吃冰淇淋融化",
  "吃午餐",
  "吃大闸蟹",
  "吃年糕",
  "吃早餐",
  "吃晚餐",
  "吃汤圆",
  "吃白饭",
  "吃粽子",
  "吃糖葫芦",
  "吃腊八粥",
  "吃西瓜",
  "吃重阳糕",
  "吃长寿面",
  "吃青团",
  "吃饺子",
  "吹气球",
  "吹笛子",
  "哈欠连天",
  "堆雪人",
  "大口吃零食",
  "女仆屈膝礼仪",
  "小幅度原地360度旋转展示",
  "小提琴演奏",
  "工作状态-原地踱步张望",
  "工作状态-垂头叹气冒汗",
  "工作状态-忙碌点按",
  "工作状态-思考冒泡",
  "工作状态-清点归档",
  "工作状态-雀跃庆祝",
  "待机呼吸休闲",
  "悠闲哼歌",
  "扑克魔术",
  "打瞌睡被惊醒",
  "抽陀螺",
  "拆礼物",
  "插茱萸赏菊",
  "摇扇纳凉",
  "撸猫",
  "收红包",
  "放孔明灯",
  "放河灯",
  "放烟花",
  "放风筝",
  "整体换装试色",
  "是啊，吃什么",
  "晨间刷牙",
  "涮火锅",
  "深度思考碎碎念",
  "点击回应-傲娇生气",
  "点击回应-元气挥手",
  "点击回应-害羞惊讶",
  "点击回应-开心跃动",
  "点击回应-挠痒咯咯笑",
  "照镜子",
  "玩水枪",
  "玩游戏气急败坏",
  "用鲸鱼尾巴拍打地面",
  "碎碎念-发呆碎碎念",
  "碎碎念-对屏碎碎念",
  "碎碎念-擦桌碎碎念",
  "穿针乞巧",
  "舞狮头",
  "荡秋千",
  "萌化小幽灵",
  "蓝鲸现世",
  "蝴蝶蜜蜂环绕头顶开花",
  "螃蟹走路",
  "被吓一跳",
  "被落叶淹没",
  "被鼠标拖拽悬空反馈",
  "装点圣诞树",
  "讨糖南瓜灯",
  "超大伸懒腰",
  "踢毽子",
  "轻快摇摆舞",
  "轻快记录",
  "骑木马",
  "鲸鱼吐泡泡特效"
] as const;

export const UPSTREAM_CHARACTER_PREVIEWS = {
  "v1": {
    "src": "",
    "description": "106 个逐帧动作"
  },
  "v2": {
    "src": "/desk-pet/previews/v2.webp",
    "description": "18 种表情"
  },
  "v3": {
    "src": "/desk-pet/previews/v3.webp",
    "description": "32 种表情"
  },
  "v4": {
    "src": "/desk-pet/previews/v4.webp",
    "description": "32 种姿势"
  },
  "v5": {
    "src": "/desk-pet/previews/v5.webp",
    "description": "16 种姿势"
  },
  "v6": {
    "src": "/desk-pet/previews/v6.webp",
    "description": "余额鲸 · 平静"
  },
  "gpt": {
    "src": "/desk-pet/previews/gpt.webp",
    "description": "专属语录 · 测试"
  }
} as const;
