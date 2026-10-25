const EN_PETS = {
  clawd: {
    name: 'Clawd',
    description: 'An orange pixel crab with left and right walking, work, gesture, and idle animations.',
  },
  'clawd-xmas': {
    name: 'Clawd (Christmas)',
    description: 'A festive Clawd variant wearing a Santa hat, with left and right walking animations.',
  },
  'hoop-23': {
    name: 'High Flyer 23',
    description: 'A pixel basketball character with dribbling and dunk animations.',
  },
  'kuro-blade': {
    name: 'Black Feather',
    description: 'A stoic swordswoman with black hair.',
  },
  makima: {
    name: 'Makima',
    description: 'A woman with red hair, a white shirt, and a black tie.',
  },
  momo: {
    name: 'Momo',
    description: 'A dark-colored cat with idle, running, and wave animations.',
  },
  nashor: {
    name: 'Baron Nashor',
    description: 'A purple creature with attack, victory, and burrow animations.',
  },
  yamada: {
    name: 'Yamada',
    description: 'A pixel character in a leather jacket, with standing and seated animations.',
  },
  'yamada-clerk': {
    name: 'Yamada (Clerk)',
    description: 'A pixel character in a red apron, with idle and gesture animations.',
  },
  'yamada-q': {
    name: 'Yamada (Chibi)',
    description: 'A chibi clerk in a red bandana with nine animation states.',
  },
};

const EN_TAGS = {
  '像素': 'Pixel art',
  '螃蟹': 'Crab',
  '节日': 'Holiday',
  '人物': 'Character',
  '篮球': 'Basketball',
  '剑士': 'Swordfighter',
  '动物': 'Animal',
  '未完成': 'In progress',
  '怪物': 'Monster',
  '动作': 'Action',
  'Q版': 'Chibi',
};

// Translate the manifest label, since an animation key can describe a different action.
const EN_LABELS = {
  '向右行走': 'Walk right',
  '向左行走': 'Walk left',
  '睡觉': 'Sleep',
  '思考': 'Think',
  '打字': 'Type',
  '敲键盘': 'Type on keyboard',
  '戴耳机听': 'Listen with headphones',
  '挥手': 'Wave',
  '眨眼': 'Blink',
  '开心跳': 'Jump for joy',
  '欢呼': 'Cheer',
  '跳舞': 'Dance',
  '指一指': 'Point',
  '扫地': 'Sweep',
  '搬箱子': 'Carry a box',
  '搭积木': 'Build with blocks',
  '出错啦': 'Error',
  '转球': 'Spin the ball',
  '扣篮': 'Dunk',
  '运球': 'Dribble',
  '抱臂': 'Cross arms',
  '运球扣篮': 'Dribble and dunk',
  '跳跃': 'Jump',
  '探头': 'Peek',
  '拔刀': 'Draw sword',
  '成功': 'Success',
  '失败': 'Failure',
  '录制中': 'Recording',
  '暂停': 'Paused',
  '揣手摇摆': 'Sway with hands tucked in',
  '升星': 'Star upgrade',
  '姿态展示': 'Strike a pose',
  '普攻': 'Basic attack',
  '胜利': 'Victory',
  '吐酸': 'Spit acid',
  '普攻接吐酸': 'Basic attack, then spit acid',
  '遁地（向左）': 'Burrow left',
  '遁地（向右）': 'Burrow right',
  '跳一跳': 'Hop',
  '忙碌中': 'Busy',
  '等待中': 'Waiting',
  '审阅': 'Review',
  '失败了': 'Failed',
  '打招呼': 'Say hello',
  '站着抽烟': 'Smoke while standing',
  '坐下抽烟': 'Sit down and smoke',
  '双手托腮': 'Rest chin in hands',
};

/** Localize bundled display metadata on raw or normalized pets without mutating them. */
export function localizePet(pet, locale, source = 'bundled') {
  if (locale !== 'en' || source !== 'bundled' || !pet || !Object.hasOwn(EN_PETS, pet.id)) return pet;

  return {
    ...pet,
    ...EN_PETS[pet.id],
    tags: pet.tags.map((tag) => Object.hasOwn(EN_TAGS, tag) ? EN_TAGS[tag] : tag),
    animations: Object.fromEntries(Object.entries(pet.animations).map(([name, animation]) => [
      name,
      Object.hasOwn(animation, 'label')
        ? {
          ...animation,
          label: Object.hasOwn(EN_LABELS, animation.label) ? EN_LABELS[animation.label] : animation.label,
        }
        : animation,
    ])),
  };
}
