// The palette, shared by the stylesheet (as custom properties) and the canvases.

export const PAPER = '#f6f5f1';
export const INK = '#111110';
export const INK_2 = 'rgba(17, 17, 16, 0.64)';
export const INK_3 = 'rgba(17, 17, 16, 0.4)';
export const INK_4 = 'rgba(17, 17, 16, 0.24)';
export const LINE = 'rgba(17, 17, 16, 0.2)';
export const RED = '#e3001b';
export const GREY = '#bfbeb8';

export const FONT = '"Helvetica Neue", Helvetica, Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

/** Device pixels per CSS pixel, capped so large canvases stay cheap to redraw. */
export const pixelRatio = (): number => Math.min(3, window.devicePixelRatio || 1);
