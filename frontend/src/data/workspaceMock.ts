import type { WordbookItem } from '../domain/types'

export type CoverTone = 'blue' | 'amber' | 'green' | 'lavender' | 'rose' | 'slate'

export type WorkspaceBook = {
  id: string
  title: string
  wordCount: number
  progress: number
  tone: CoverTone
  shortLabel: string
  lastStudy: string
  entries: WordbookItem[]
}

export type MarketplaceBook = {
  id: string
  title: string
  description: string
  author: string
  wordCount: number
  rating: number
  learners: string
  category: string
  exam: string
  tone: CoverTone
  shortLabel: string
  badge?: string
  uploaded?: boolean
}

const ENTRY_DEFINITIONS = [
  ['empirical', '/emˈpɪrɪkəl/', 'adj.', '基于经验的；实证的', 'There is little empirical evidence to support this claim.'],
  ['inevitable', '/ɪnˈevɪtəbəl/', 'adj.', '不可避免的；必然的', 'Change is inevitable in a fast-moving world.'],
  ['prioritize', '/praɪˈɒrətaɪz/', 'v.', '优先考虑；优先处理', 'Students should prioritize the most important tasks.'],
  ['contribute', '/kənˈtrɪbjuːt/', 'v.', '有助于；促成；贡献', 'Regular reading can contribute to better writing.'],
  ['subsequent', '/ˈsʌbsɪkwənt/', 'adj.', '随后的；后来的', 'The subsequent study confirmed the result.'],
  ['coherent', '/kəʊˈhɪərənt/', 'adj.', '连贯的；合乎逻辑的', 'A coherent argument is easier to follow.'],
] as const

function makeEntries(prefix: string): WordbookItem[] {
  return ENTRY_DEFINITIONS.map(([word, phonetic, pos, definition, example], index) => ({
    id: `${prefix}-${word}`,
    word,
    phonetic,
    source: 'local-ielts',
    addedAt: new Date(2026, 6, Math.max(1, 20 - index)).toISOString(),
    meanings: [{ pos, definition, example }],
  }))
}

export const INITIAL_WORKSPACE_BOOKS: WorkspaceBook[] = [
  {
    id: 'ielts-writing-task-2',
    title: 'IELTS Writing Task 2',
    wordCount: 326,
    progress: 65,
    tone: 'blue',
    shortLabel: 'IELTS\nWRITING\nTASK 2',
    lastStudy: '今天',
    entries: makeEntries('writing'),
  },
  {
    id: 'reading-core',
    title: '阅读生词本',
    wordCount: 152,
    progress: 41,
    tone: 'slate',
    shortLabel: 'READING',
    lastStudy: '昨天',
    entries: makeEntries('reading').slice(0, 5),
  },
  {
    id: 'listening-errors',
    title: '听力错词本',
    wordCount: 89,
    progress: 52,
    tone: 'rose',
    shortLabel: 'LISTEN',
    lastStudy: '3 天前',
    entries: makeEntries('listening').slice(1),
  },
  {
    id: 'gaokao-difficult',
    title: '高频难词本',
    wordCount: 64,
    progress: 28,
    tone: 'amber',
    shortLabel: 'CORE\nWORDS',
    lastStudy: '7 天前',
    entries: makeEntries('difficult').slice(0, 4),
  },
  {
    id: 'kaoyan-core',
    title: '考研核心词汇',
    wordCount: 538,
    progress: 73,
    tone: 'green',
    shortLabel: 'MASTER',
    lastStudy: '今天',
    entries: makeEntries('kaoyan'),
  },
  {
    id: 'daily-scenes',
    title: '日常积累',
    wordCount: 112,
    progress: 35,
    tone: 'green',
    shortLabel: 'DAILY',
    lastStudy: '9 天前',
    entries: makeEntries('daily').slice(2),
  },
]

export const MARKETPLACE_BOOKS: MarketplaceBook[] = [
  {
    id: 'ielts-core', title: 'IELTS 核心词汇', description: '雅思考试高频词，覆盖听说读写常见场景。', author: 'Luna', wordCount: 5000, rating: 4.8, learners: '2.3万人使用', category: 'IELTS', exam: 'IELTS', tone: 'blue', shortLabel: 'IELTS', badge: '社区热门',
  },
  {
    id: 'gaokao-3500', title: '高考3500', description: '高考英语核心词汇，适合基础巩固与阶段复习。', author: '字海无涯', wordCount: 3500, rating: 4.7, learners: '3.1万人使用', category: '高考', exam: '高考', tone: 'amber', shortLabel: '3500', badge: '社区热门',
  },
  {
    id: 'cet-advanced', title: '四六级高频词', description: '精选高频词汇，助力备考四六级考试。', author: 'CETer', wordCount: 3200, rating: 4.6, learners: '1.8万人使用', category: '四六级', exam: '四六级', tone: 'green', shortLabel: 'CET', badge: '最新上传', uploaded: true,
  },
  {
    id: 'reading-academic', title: '阅读难词合集', description: '精选阅读难词与学术词，提升阅读能力。', author: 'ReadMaster', wordCount: 2000, rating: 4.7, learners: '9千人使用', category: '阅读', exam: '托福', tone: 'rose', shortLabel: 'READ',
  },
  {
    id: 'writing-gaofen', title: '考研英语写作', description: '写作高分词汇与搭话，涵盖必备表达。', author: 'WritingLab', wordCount: 1200, rating: 4.9, learners: '1.2万人使用', category: '写作', exam: '考研', tone: 'lavender', shortLabel: 'WRITE', uploaded: true,
  },
  {
    id: 'spoken-topic', title: '雅思口语话题词', description: '按话题分类的口语词汇，地道表达积累。', author: 'SpeakUp', wordCount: 1500, rating: 4.8, learners: '1.6万人使用', category: '口语', exam: 'IELTS', tone: 'blue', shortLabel: 'SPEAK',
  },
  {
    id: 'reading-frequent', title: '阅读难词合集', description: '精选阅读难词与学术词，提升阅读能力。', author: 'ReadMaster', wordCount: 2000, rating: 4.7, learners: '9千人使用', category: '阅读', exam: '托福', tone: 'rose', shortLabel: 'READ',
  },
]

export const MARKETPLACE_CATEGORIES = ['全部', 'IELTS', '高考', '四六级', '考研', '托福', '写作', '阅读', '口语']
