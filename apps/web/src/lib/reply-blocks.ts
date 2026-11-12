/** Bloc d'une réponse de l'agent IA affichée dans le simulateur : texte (retours à la ligne gardés) ou liste à puces. */
export type ReplyBlock = { kind: 'text'; text: string } | { kind: 'list'; items: string[] };

/** Ligne de liste : « - » ou « • » en tête (espaces avant permis), suivi d'une espace. */
const BULLET = /^\s*[-•]\s+(.*)$/;

/**
 * Découpe une réponse en blocs (recette du 12 nov. 2026) : les lignes consécutives qui commencent par « - » ou « • »
 * forment une liste, les autres restent du texte avec leurs retours à la ligne. Le résultat ne contient que du texte :
 * rien n'est interprété comme du HTML, React l'affiche tel quel. Un bloc de texte vide (lignes blanches seules) est omis.
 */
export function replyBlocks(reply: string): ReplyBlock[] {
  const blocks: ReplyBlock[] = [];
  let text: string[] = [];
  const flushText = () => {
    const joined = text.join('\n');
    if (joined.trim() !== '') blocks.push({ kind: 'text', text: joined });
    text = [];
  };
  for (const line of reply.replace(/\r\n?/g, '\n').split('\n')) {
    const bullet = BULLET.exec(line);
    if (bullet) {
      flushText();
      const last = blocks.at(-1);
      if (last?.kind === 'list') last.items.push(bullet[1]);
      else blocks.push({ kind: 'list', items: [bullet[1]] });
    } else {
      text.push(line);
    }
  }
  flushText();
  return blocks;
}
