'use strict';
async function copyCard(image, { clipboard, ClipboardItem }) {
  if (!image || image.isEmpty()) throw new Error('Не удалось получить изображение карточки. Попробуй ещё раз.');
  const png = image.toPNG();
  if (!png.length) throw new Error('Не удалось подготовить изображение карточки.');
  if (typeof clipboard.writeImage === 'function') { clipboard.writeImage(image); return; }
  // Electron 44+ removed writeImage; the write promise completes only after the
  // actual PNG has been committed to the operating-system clipboard.
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]);
}
module.exports = { copyCard };
