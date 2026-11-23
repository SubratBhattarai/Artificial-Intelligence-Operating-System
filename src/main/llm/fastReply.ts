/**
 * Questions with an exact, local answer never need the language model. They are answered instantly
 * from the system clock, so they cost no thinking time at all.
 */
export function fastReply(text: string, now: Date = new Date()): string | null {
  const cleaned = text
    .toLowerCase()
    .replace(/[.!?,]+$/g, '')
    .replace(/^(hey |hi |ok |okay )?jarvis,? ?/, '')
    .trim();
  if (cleaned.length === 0 || cleaned.length > 40) return null;
  if (/^(what('s| is)? ?(the )?)?(current )?time( is it)?( now| right now)?$/.test(cleaned)) {
    return `It is ${now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`;
  }
  if (/^(what('s| is)? ?(the |today'?s? )?)?(date|day)( is it)?( today)?$/.test(cleaned)) {
    return `Today is ${now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}.`;
  }
  if (/^(hi|hello|hey|good (morning|afternoon|evening))( there)?$/.test(cleaned)) {
    return 'Hello. How can I help?';
  }
  if (/^(thanks|thank you)( jarvis| so much)?$/.test(cleaned)) return "You're welcome.";
  return null;
}
