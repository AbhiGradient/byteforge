const config = require('./config');
const engine = require('./engine');
const gemini = require('./gemini');
const personal = require('./personal');
const prompts = require('./prompts');
const catalog = require('./catalog');

// ---- intent detection ------------------------------------------------------

const WORD_OPERATORS = /\b(plus|minus|times|multiplied by|divided by|over|modulo|mod|to the power of|raised to|power)\b/g;
const OPERATOR_WORDS = { plus: '+', minus: '-', times: '*', 'multiplied by': '*', 'divided by': '/', over: '/', modulo: '%', mod: '%', 'to the power of': '^', 'raised to': '^', power: '^' };
const FILLER = /\b(what|whats|what's|is|are|the|calculate|compute|evaluate|solve|find|value|of|result|equals|equal|please|tell|me|answer|to|simplify)\b/g;
const MATH_TOPIC =
  /(\b(integra(l|te|tion)|derivative|differentiat\w*|d\/dx|limit|sin|cos|tan|cot|sec|csc|log|ln|sqrt|square root|cube root|root|matrix|matrices|determinant|eigen\w*|probability|permutation|combination|quadratic|equation|solve|simplify|factori[sz]e|expand|percent\w*|mean|median|variance|standard deviation|angle|triangle|circle|area|volume|prove|theorem|series|sum of)\b|∫|√|π)/i;
const DEFINITIVE_ERRORS = /zero|undefined|too large|no real result/i;

/** Returns an arithmetic expression when the whole message is plain arithmetic, else null. */
function pureArithmetic(message) {
  if (message.length > 120) return null;
  let t = message.toLowerCase().trim();
  if (/^\d{1,4}[-/]\d{1,2}[-/]\d{1,4}$/.test(t)) return null;
  t = t.replace(WORD_OPERATORS, (m) => ` ${OPERATOR_WORDS[m]} `);
  t = t.replace(FILLER, ' ');
  t = t.replace(/(\d)\s*[x×]\s*(?=[\d(.])/g, '$1 * ').replace(/÷/g, '/');
  t = t.replace(/=\s*\??\s*$/, '').replace(/\?+\s*$/, '').trim();
  if (!/\d/.test(t) || !/[+\-*/%^]/.test(t)) return null;
  if (!/^[\d\s.+\-*/%^()]*$/.test(t)) return null;
  return t.replace(/\s+/g, ' ');
}

// ---- helpers ---------------------------------------------------------------

function buildContents(history, message) {
  const turns = [];
  for (const item of history) {
    const role = item.role === 'ai' || item.role === 'model' ? 'model' : 'user';
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.text += `\n${item.text}`;
    else turns.push({ role, text: item.text });
  }
  while (turns.length && turns[0].role !== 'user') turns.shift();
  const last = turns[turns.length - 1];
  if (last && last.role === 'user') last.text += `\n${message}`;
  else turns.push({ role: 'user', text: message });
  return turns;
}

async function contextNote(context) {
  if (!context || typeof context.algorithmId !== 'string') return '';
  const entry = await catalog.get(context.algorithmId);
  if (!entry) return '';
  let note = `\nThe learner currently has "${entry.name}" (${entry.category}) open in the BYTEFORGE lab. Authoritative complexity: ${catalog.complexityText(entry)}.`;
  if (context.input && typeof context.input === 'object') {
    const text = JSON.stringify(context.input);
    if (text.length <= 1200) note += ` Their current input is ${text}.`;
  }
  return note;
}

async function arithmeticReply(expression) {
  const result = await engine.math(expression);
  if (result.ok) {
    const pretty = expression.replace(/\*/g, ' × ').replace(/\//g, ' ÷ ').replace(/\s+/g, ' ');
    return {
      answer: `\`${expression}\` = **${result.formatted}**\n\nEvaluated locally by the C++ engine with the Shunting Yard algorithm.\n\n- Tokens: \`${result.tokens.join(' ')}\`\n- Postfix (RPN): \`${result.postfix.join(' ')}\`\n- Readable: ${pretty}`,
      engine: 'cpp-math',
      engineLabel: 'C++ math engine',
      model: null,
      notice: null,
      value: result.formatted
    };
  }
  if (DEFINITIVE_ERRORS.test(result.error)) {
    return {
      answer: `\`${expression}\` cannot be evaluated: ${result.error}`,
      engine: 'cpp-math',
      engineLabel: 'C++ math engine',
      model: null,
      notice: null,
      value: null
    };
  }
  return null;
}

// ---- main entry ------------------------------------------------------------

async function handleChat({ message, history = [], context = null, style = 'concise', allowPersonal = true }) {
  if (allowPersonal) {
    const hit = personal.match(message);
    if (hit) {
      return {
        answer: hit.answer,
        engine: 'personal',
        engineLabel: 'Personal knowledge file',
        model: null,
        notice: null,
        matched: hit.question
      };
    }
  }

  const expression = pureArithmetic(message);
  let notice = null;
  if (expression) {
    try {
      const reply = await arithmeticReply(expression);
      if (reply) return reply;
    } catch (err) {
      notice = 'The C++ engine was unavailable, so this arithmetic question was sent to Gemini instead.';
      console.warn(`[chat] C++ math engine unavailable: ${err.message}`);
    }
  }

  const isMath = Boolean(expression) || MATH_TOPIC.test(message);
  const system = prompts.chat(style) + (isMath ? ` ${prompts.math}` : '') + (await contextNote(context));
  const result = await gemini.generate({
    system,
    contents: buildContents(history, message),
    maxOutputTokens: style === 'detailed' ? 4096 : 2048
  });
  return {
    answer: result.text,
    engine: isMath ? 'gemini-math' : 'gemini',
    engineLabel: isMath ? 'Gemini (mathematical reasoning)' : 'Gemini',
    model: result.model,
    notice,
    truncated: result.finishReason === 'MAX_TOKENS'
  };
}

module.exports = { handleChat, pureArithmetic };
