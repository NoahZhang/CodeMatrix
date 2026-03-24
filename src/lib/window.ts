// Window management — wraps Tauri window API.

import { getCurrentWindow, type PhysicalSize, type PhysicalPosition } from '@tauri-apps/api/window';

export type Position = { x: number; y: number };
export type Size = { width: number; height: number };

type UnlistenFn = () => void;

class AppWindow {
  private get win() {
    return getCurrentWindow();
  }

  async isFocused(): Promise<boolean> {
    return this.win.isFocused();
  }

  async isMaximized(): Promise<boolean> {
    return this.win.isMaximized();
  }

  async setDecorations(decorated: boolean): Promise<void> {
    await this.win.setDecorations(decorated);
  }

  async setTitleBarStyle(style: string): Promise<void> {
    // Tauri v2 handles this via tauri.conf.json titleBarStyle
    // This is now a no-op — configured at build time
    void style;
  }

  async minimize(): Promise<void> {
    await this.win.minimize();
  }

  async toggleMaximize(): Promise<void> {
    await this.win.toggleMaximize();
  }

  async maximize(): Promise<void> {
    await this.win.maximize();
  }

  async unmaximize(): Promise<void> {
    await this.win.unmaximize();
  }

  async close(): Promise<void> {
    await this.win.close();
  }

  async hide(): Promise<void> {
    await this.win.hide();
  }

  async setSize(size: Size): Promise<void> {
    // outerSize() returns physical pixels, so restore as physical to avoid
    // Retina 2x mismatch (logical would double the size → resize loop → shake).
    await this.win.setSize({ type: 'Physical', width: Math.round(size.width), height: Math.round(size.height) } as PhysicalSize);
  }

  async setPosition(pos: Position): Promise<void> {
    // outerPosition() returns physical pixels — keep the same coordinate space.
    await this.win.setPosition({ type: 'Physical', x: Math.round(pos.x), y: Math.round(pos.y) } as PhysicalPosition);
  }

  async outerPosition(): Promise<Position> {
    const pos = await this.win.outerPosition();
    return { x: pos.x, y: pos.y };
  }

  async outerSize(): Promise<Size> {
    const size = await this.win.outerSize();
    return { width: size.width, height: size.height };
  }

  async startDragging(): Promise<void> {
    await this.win.startDragging();
  }

  async startResizeDragging(direction: string): Promise<void> {
    // Tauri v2 handles resize via native decorations or startResizeDragging
    void direction;
  }

  async onFocusChanged(handler: (event: { payload: boolean }) => void): Promise<UnlistenFn> {
    const unlisten1 = await this.win.onFocusChanged((event) => {
      handler({ payload: event.payload });
    });
    return unlisten1;
  }

  async onResized(handler: () => void): Promise<UnlistenFn> {
    return this.win.onResized(() => handler());
  }

  async onMoved(handler: () => void): Promise<UnlistenFn> {
    return this.win.onMoved(() => handler());
  }

  async onCloseRequested(
    handler: (event: { preventDefault: () => void }) => Promise<void> | void,
  ): Promise<UnlistenFn> {
    return this.win.onCloseRequested(async (event) => {
      const result = handler({
        preventDefault: () => {
          event.preventDefault();
        },
      });
      if (result instanceof Promise) {
        await result;
      }
    });
  }
}

export const appWindow = new AppWindow();
