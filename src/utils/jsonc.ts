/**
 * Parse JSON with comments and trailing commas (tsconfig.json style).
 *
 * @throws {SyntaxError} when the text is not valid JSONC
 */
export function parseJsonc(text: string): unknown {
  let output = "";
  let index = 0;
  const length = text.length;

  while (index < length) {
    const character = text[index]!;

    if (character === '"') {
      const start = index;
      index++;
      while (index < length && text[index] !== '"') {
        index += text[index] === "\\" ? 2 : 1;
      }
      index++;
      output += text.slice(start, index);
      continue;
    }

    if (character === "/" && text[index + 1] === "/") {
      while (index < length && text[index] !== "\n") index++;
      continue;
    }

    if (character === "/" && text[index + 1] === "*") {
      const end = text.indexOf("*/", index + 2);
      index = end === -1 ? length : end + 2;
      continue;
    }

    output += character;
    index++;
  }

  // Remove trailing commas before } or ] (strings were copied verbatim above,
  // so re-scan while skipping them).
  let cleaned = "";
  for (let position = 0; position < output.length; position++) {
    const character = output[position]!;
    if (character === '"') {
      const start = position;
      position++;
      while (position < output.length && output[position] !== '"') {
        position += output[position] === "\\" ? 2 : 1;
      }
      cleaned += output.slice(start, position + 1);
      continue;
    }
    if (character === ",") {
      let lookahead = position + 1;
      while (lookahead < output.length && /\s/.test(output[lookahead]!)) lookahead++;
      if (output[lookahead] === "}" || output[lookahead] === "]") continue;
    }
    cleaned += character;
  }

  return JSON.parse(cleaned);
}
