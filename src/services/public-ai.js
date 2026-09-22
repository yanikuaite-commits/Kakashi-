export function imagePromptUrl(prompt) {
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}`;
}

export function googleTtsUrl(text, language = "pt-BR") {
  return `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${language}&q=${encodeURIComponent(text)}`;
}