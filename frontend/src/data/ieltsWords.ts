import type { WordEntry } from '../domain/types'

/**
 * Curated IELTS academic core vocabulary.
 * Checked first, before any network request — guarantees the app
 * works offline and stays fast for the words learners meet most.
 */
export const IELTS_WORDS: WordEntry[] = [
  {
    word: 'resilient',
    phonetic: '/rɪˈzɪliənt/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'adjective',
        definition: 'Able to recover quickly from difficult conditions or change.',
        example: 'Local economies must become resilient to climate shocks.',
      },
    ],
  },
  {
    word: 'mitigate',
    phonetic: '/ˈmɪtɪɡeɪt/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'verb',
        definition: 'To make something harmful, unpleasant, or serious less severe.',
        example: 'Planting more trees helps mitigate the effects of air pollution.',
      },
    ],
  },
  {
    word: 'prevalent',
    phonetic: '/ˈprevələnt/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'adjective',
        definition: 'Existing very commonly or happening often in a particular place or time.',
        example: 'This view is particularly prevalent among young urban professionals.',
      },
    ],
  },
  {
    word: 'sustainable',
    phonetic: '/səˈsteɪnəbəl/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'adjective',
        definition: 'Able to continue over time without damaging the environment or using resources too quickly.',
        example: 'Governments are investing in sustainable sources of energy.',
      },
    ],
  },
  {
    word: 'significant',
    phonetic: '/sɪɡˈnɪfɪkənt/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'adjective',
        definition: 'Important or large enough to have a noticeable effect or to deserve attention.',
        example: 'The survey found a significant rise in part-time employment.',
      },
    ],
  },
  {
    word: 'alleviate',
    phonetic: '/əˈliːvieɪt/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'verb',
        definition: 'To make pain, suffering, or a problem less severe.',
        example: 'Building more cycle lanes could alleviate traffic congestion.',
      },
    ],
  },
  {
    word: 'ambiguous',
    phonetic: '/æmˈbɪɡjuəs/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'adjective',
        definition: 'Having more than one possible meaning, and therefore unclear.',
        example: 'The wording of the law is deliberately ambiguous.',
      },
    ],
  },
  {
    word: 'comprehensive',
    phonetic: '/ˌkɒmprɪˈhensɪv/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'adjective',
        definition: 'Including everything or nearly everything that is needed.',
        example: 'The report offers a comprehensive analysis of urban transport.',
      },
    ],
  },
  {
    word: 'controversial',
    phonetic: '/ˌkɒntrəˈvɜːʃəl/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'adjective',
        definition: 'Causing strong public disagreement or argument.',
        example: 'Whether children should own smartphones remains controversial.',
      },
    ],
  },
  {
    word: 'deteriorate',
    phonetic: '/dɪˈtɪəriəreɪt/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'verb',
        definition: 'To become progressively worse in quality or condition.',
        example: 'Air quality tends to deteriorate as cities industrialise.',
      },
    ],
  },
  {
    word: 'detrimental',
    phonetic: '/ˌdetrɪˈmentəl/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'adjective',
        definition: 'Causing harm or damage.',
        example: 'Excessive screen time can be detrimental to children’s sleep.',
      },
    ],
  },
  {
    word: 'diverse',
    phonetic: '/daɪˈvɜːs/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'adjective',
        definition: 'Including many different types of people or things.',
        example: 'Universities benefit from a culturally diverse student body.',
      },
    ],
  },
  {
    word: 'elaborate',
    phonetic: '/ɪˈlæbərət/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'adjective',
        definition: 'Very detailed and complicated; carefully planned.',
        example: 'The festival involves elaborate costumes and rituals.',
      },
      {
        pos: 'verb',
        definition: 'To explain something in more detail.',
        example: 'The lecturer was asked to elaborate on her final point.',
      },
    ],
  },
  {
    word: 'empirical',
    phonetic: '/ɪmˈpɪrɪkəl/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'adjective',
        definition: 'Based on observation or experiment rather than theory.',
        example: 'There is little empirical evidence to support this claim.',
      },
    ],
  },
  {
    word: 'enhance',
    phonetic: '/ɪnˈhɑːns/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'verb',
        definition: 'To improve the quality, value, or strength of something.',
        example: 'Reading widely enhances both vocabulary and critical thinking.',
      },
    ],
  },
  {
    word: 'equitable',
    phonetic: '/ˈekwɪtəbəl/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'adjective',
        definition: 'Fair and reasonable; treating everyone in an equal way.',
        example: 'Access to healthcare should be equitable across regions.',
      },
    ],
  },
  {
    word: 'exacerbate',
    phonetic: '/ɪɡˈzæsəbeɪt/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'verb',
        definition: 'To make a bad situation or problem worse.',
        example: 'Cutting bus services would exacerbate rural isolation.',
      },
    ],
  },
  {
    word: 'feasible',
    phonetic: '/ˈfiːzəbəl/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'adjective',
        definition: 'Possible and practical to achieve.',
        example: 'It is not feasible to ban all private cars overnight.',
      },
    ],
  },
  {
    word: 'fluctuate',
    phonetic: '/ˈflʌktʃueɪt/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'verb',
        definition: 'To change level or amount frequently and irregularly.',
        example: 'Oil prices fluctuate in response to global demand.',
      },
    ],
  },
  {
    word: 'fundamental',
    phonetic: '/ˌfʌndəˈmentəl/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'adjective',
        definition: 'Forming the necessary base or core; of central importance.',
        example: 'Trust is fundamental to any functioning society.',
      },
    ],
  },
  {
    word: 'imminent',
    phonetic: '/ˈɪmɪnənt/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'adjective',
        definition: 'About to happen very soon.',
        example: 'Scientists warned that a water shortage was imminent.',
      },
    ],
  },
  {
    word: 'implication',
    phonetic: '/ˌɪmplɪˈkeɪʃən/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'noun',
        definition: 'A likely effect or consequence of an action or decision.',
        example: 'The policy has serious implications for low-income families.',
      },
    ],
  },
  {
    word: 'incentive',
    phonetic: '/ɪnˈsentɪv/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'noun',
        definition: 'Something that encourages a person to do something.',
        example: 'Tax breaks give companies an incentive to go green.',
      },
    ],
  },
  {
    word: 'inevitable',
    phonetic: '/ɪnˈevɪtəbəl/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'adjective',
        definition: 'Certain to happen and impossible to avoid.',
        example: 'Some job losses seem inevitable as automation spreads.',
      },
    ],
  },
  {
    word: 'infrastructure',
    phonetic: '/ˈɪnfrəstrʌktʃə/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'noun',
        definition: 'The basic systems and structures a country or organisation needs to work properly.',
        example: 'Developing countries often prioritise infrastructure over the arts.',
      },
    ],
  },
  {
    word: 'innovative',
    phonetic: '/ˈɪnəveɪtɪv/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'adjective',
        definition: 'Introducing or using new ideas, methods, or inventions.',
        example: 'The city adopted innovative solutions to recycle wastewater.',
      },
    ],
  },
  {
    word: 'integrity',
    phonetic: '/ɪnˈteɡrəti/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'noun',
        definition: 'The quality of being honest and having strong moral principles.',
        example: 'Academic integrity is taken seriously at every university.',
      },
    ],
  },
  {
    word: 'lucrative',
    phonetic: '/ˈluːkrətɪv/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'adjective',
        definition: 'Producing a large amount of money; very profitable.',
        example: 'Many graduates are drawn to lucrative careers in finance.',
      },
    ],
  },
  {
    word: 'notion',
    phonetic: '/ˈnəʊʃən/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'noun',
        definition: 'An idea, belief, or opinion about something.',
        example: 'The notion that money buys happiness is increasingly questioned.',
      },
    ],
  },
  {
    word: 'obsolete',
    phonetic: '/ˈɒbsəliːt/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'adjective',
        definition: 'No longer used or needed because something better exists.',
        example: 'Fax machines have become almost obsolete in most offices.',
      },
    ],
  },
  {
    word: 'paradigm',
    phonetic: '/ˈpærədaɪm/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'noun',
        definition: 'A typical example or model of how something works or is understood.',
        example: 'Remote work represents a paradigm shift in employment.',
      },
    ],
  },
  {
    word: 'phenomenon',
    phonetic: '/fəˈnɒmɪnən/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'noun',
        definition: 'Something that exists and can be seen, felt, or observed, especially something remarkable.',
        example: 'Urbanisation is a global phenomenon that continues to accelerate.',
      },
    ],
  },
  {
    word: 'plausible',
    phonetic: '/ˈplɔːzəbəl/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'adjective',
        definition: 'Seeming reasonable or probably true.',
        example: 'The most plausible explanation is a change in consumer habits.',
      },
    ],
  },
  {
    word: 'prosperous',
    phonetic: '/ˈprɒspərəs/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'adjective',
        definition: 'Successful, especially in financial terms; wealthy.',
        example: 'Tourism has made the coastal towns far more prosperous.',
      },
    ],
  },
  {
    word: 'rigorous',
    phonetic: '/ˈrɪɡərəs/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'adjective',
        definition: 'Extremely thorough, careful, and strict.',
        example: 'The findings are based on rigorous scientific testing.',
      },
    ],
  },
  {
    word: 'scrutinise',
    phonetic: '/ˈskruːtənaɪz/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'verb',
        definition: 'To examine something very carefully and critically.',
        example: 'Governments should scrutinise how tech firms use personal data.',
      },
    ],
  },
  {
    word: 'subsequent',
    phonetic: '/ˈsʌbsɪkwənt/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'adjective',
        definition: 'Happening or coming after something else.',
        example: 'The initial trial failed, but subsequent experiments succeeded.',
      },
    ],
  },
  {
    word: 'substantial',
    phonetic: '/səbˈstænʃəl/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'adjective',
        definition: 'Large in size, amount, or importance.',
        example: 'A substantial proportion of the budget goes to defence.',
      },
    ],
  },
  {
    word: 'susceptible',
    phonetic: '/səˈseptəbəl/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'adjective',
        definition: 'Easily influenced or harmed by something.',
        example: 'Young children are particularly susceptible to online advertising.',
      },
    ],
  },
  {
    word: 'tangible',
    phonetic: '/ˈtændʒəbəl/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'adjective',
        definition: 'Real and clear enough to be seen, measured, or felt.',
        example: 'The scheme produced tangible benefits within a year.',
      },
    ],
  },
  {
    word: 'undermine',
    phonetic: '/ˌʌndəˈmaɪn/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'verb',
        definition: 'To gradually weaken or damage something, especially confidence or authority.',
        example: 'Constant criticism can undermine a child’s self-esteem.',
      },
    ],
  },
  {
    word: 'ubiquitous',
    phonetic: '/juːˈbɪkwɪtəs/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'adjective',
        definition: 'Seeming to be everywhere at the same time.',
        example: 'Smartphones have become ubiquitous in modern life.',
      },
    ],
  },
  {
    word: 'viable',
    phonetic: '/ˈvaɪəbəl/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'adjective',
        definition: 'Capable of working successfully; practical.',
        example: 'Solar power is now a viable alternative to fossil fuels.',
      },
    ],
  },
  {
    word: 'vulnerable',
    phonetic: '/ˈvʌlnərəbəl/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'adjective',
        definition: 'Easily harmed physically, emotionally, or economically.',
        example: 'Coastal cities are vulnerable to rising sea levels.',
      },
    ],
  },
  {
    word: 'warrant',
    phonetic: '/ˈwɒrənt/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'verb',
        definition: 'To make an action seem necessary or justified.',
        example: 'The problem is not serious enough to warrant new legislation.',
      },
      {
        pos: 'noun',
        definition: 'An official document giving authority to do something.',
        example: 'Police obtained a warrant to search the premises.',
      },
    ],
  },
  {
    word: 'acknowledge',
    phonetic: '/əkˈnɒlɪdʒ/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'verb',
        definition: 'To accept or admit that something exists or is true.',
        example: 'Critics acknowledge that electric cars still have limitations.',
      },
    ],
  },
  {
    word: 'contemplate',
    phonetic: '/ˈkɒntəmpleɪt/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'verb',
        definition: 'To think about something carefully and for a long time.',
        example: 'Few families contemplate moving abroad permanently.',
      },
    ],
  },
  {
    word: 'discrepancy',
    phonetic: '/dɪˈskrepənsi/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'noun',
        definition: 'A difference between two things that should match.',
        example: 'There is a growing discrepancy between wages and living costs.',
      },
    ],
  },
  {
    word: 'demographic',
    phonetic: '/ˌdeməˈɡræfɪk/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'adjective',
        definition: 'Relating to the structure of populations.',
        example: 'Many countries face demographic change as birth rates fall.',
      },
      {
        pos: 'noun',
        definition: 'A section of the population sharing particular characteristics.',
        example: 'Streaming services target a younger demographic.',
      },
    ],
  },
  {
    word: 'compulsory',
    phonetic: '/kəmˈpʌlsəri/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'adjective',
        definition: 'Required by law or rule; obligatory.',
        example: 'Some argue a foreign language should be compulsory in schools.',
      },
    ],
  },
  {
    word: 'curriculum',
    phonetic: '/kəˈrɪkjələm/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'noun',
        definition: 'The subjects that are taught by a school or college.',
        example: 'Financial literacy is rarely part of the national curriculum.',
      },
    ],
  },
  {
    word: 'conservation',
    phonetic: '/ˌkɒnsəˈveɪʃən/',
    source: 'local-ielts',
    meanings: [
      {
        pos: 'noun',
        definition: 'The protection of the natural environment and wildlife.',
        example: 'Ecotourism can fund conservation in fragile habitats.',
      },
    ],
  },
]

function seededRandom(seed: number) {
  let value = seed | 0
  return () => {
    value |= 0
    value = value + 0x6d2b79f5 | 0
    let result = Math.imul(value ^ value >>> 15, 1 | value)
    result = result + Math.imul(result ^ result >>> 7, 61 | result) ^ result
    return ((result ^ result >>> 14) >>> 0) / 4_294_967_296
  }
}

function permutation(length: number, cycle: number) {
  const values = Array.from({ length }, (_, index) => index)
  const random = seededRandom(cycle ^ 0x56acaba7)
  for (let index = length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1))
    ;[values[index], values[target]] = [values[target], values[index]]
  }
  if (cycle > 0 && length > 1) {
    const previous = permutationRaw(length, cycle - 1)
    if (values[0] === previous[length - 1]) {
      ;[values[0], values[1]] = [values[1], values[0]]
    }
  }
  return values
}

function permutationRaw(length: number, cycle: number) {
  const values = Array.from({ length }, (_, index) => index)
  const random = seededRandom(cycle ^ 0x56acaba7)
  for (let index = length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1))
    ;[values[index], values[target]] = [values[target], values[index]]
  }
  return values
}

export function localDayNumber(date = new Date()) {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000)
}

/** Select only the headword. The full entry must come from the shared repository. */
export function wordOfTheDay(date = new Date()): string {
  const length = IELTS_WORDS.length
  const day = localDayNumber(date)
  const cycle = Math.floor(day / length)
  const position = ((day % length) + length) % length
  return IELTS_WORDS[permutation(length, cycle)[position]].word
}
