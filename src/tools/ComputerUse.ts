/**
 * ComputerUse — Vision-based computer control for browser and system-level interactions.
 * 
 * Provides coordinate-based mouse/keyboard control driven by vision model analysis
 * of screenshots. Works in two contexts:
 * 
 * - **Browser**: Uses Playwright's page.mouse/page.keyboard for in-browser control
 * - **System**: Uses OS-native commands (PowerShell / xdotool / AppleScript) for desktop control
 * 
 * The vision pipeline: screenshot → vision model → extract coordinates → execute action.
 * Falls back gracefully when vision or system control is unavailable.
 */

import { Page } from 'playwright';
import { logger } from '../utils/logger';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { execSync } from 'child_process';

// robotjs — native cross-platform mouse/keyboard/screen control
let robot: any;
try {
    robot = require('@jitsi/robotjs');
    robot.setMouseDelay(2);   // Minimal delay for responsiveness
    robot.setKeyboardDelay(10);
} catch (e) {
    logger.warn(`ComputerUse: @jitsi/robotjs not available — system-level control disabled. ${e}`);
}

export type ComputerUseContext = 'browser' | 'system';

export interface CoordinateResult {
    x: number;
    y: number;
    confidence: 'high' | 'medium' | 'low';
    description?: string;
}

export interface ScreenInfo {
    width: number;
    height: number;
    screenshotPath: string;
}

export class ComputerUse {
    private context: ComputerUseContext = 'browser';
    private page: Page | null = null;
    private pageGetter?: () => Page | null;
    private visionAnalyzer?: (screenshotPath: string, prompt: string) => Promise<string>;
    private screenshotDir: string;
    private platform: NodeJS.Platform;
    private lastScreenshot: string = '';
    private screenSize: { width: number; height: number } = { width: 1920, height: 1080 };

    constructor() {
        this.screenshotDir = path.join(os.homedir(), '.orcbot');
        this.platform = process.platform;
        if (!fs.existsSync(this.screenshotDir)) {
            fs.mkdirSync(this.screenshotDir, { recursive: true });
        }
    }

    // ─── Configuration ──────────────────────────────────────────

    /**
     * Set the active context: 'browser' for in-page control, 'system' for desktop control.
     */
    public setContext(ctx: ComputerUseContext): void {
        this.context = ctx;
        logger.info(`ComputerUse: Context set to "${ctx}"`);
    }

    public getContext(): ComputerUseContext {
        return this.context;
    }

    /**
     * Set the Playwright page reference for browser-context operations.
     * Can be set directly or via a getter function that resolves the current page lazily.
     */
    public setPage(page: Page | null): void {
        this.page = page;
    }

    /**
     * Set a lazy page getter (e.g., () => browser.page) so ComputerUse always has the current page.
     */
    public setPageGetter(getter: () => Page | null): void {
        this.pageGetter = getter;
    }

    private getPage(): Page | null {
        if (this.pageGetter) return this.pageGetter();
        return this.page;
    }

    /**
     * Set the vision analyzer callback (wraps MultiLLM.analyzeMedia).
     */
    public setVisionAnalyzer(fn: (screenshotPath: string, prompt: string) => Promise<string>): void {
        this.visionAnalyzer = fn;
    }

    /**
     * Check if computer-use is available in the current context.
     */
    public isAvailable(): boolean {
        if (this.context === 'browser') {
            const p = this.getPage();
            return p !== null && !p.isClosed();
        }
        // System context: requires robotjs
        return !!robot;
    }

    /**
     * Check if vision-based location is available (requires vision analyzer).
     */
    public hasVision(): boolean {
        return !!this.visionAnalyzer;
    }

    // ─── Screenshot ─────────────────────────────────────────────

    /**
     * Capture a screenshot in the current context.
     * Browser: captures the page. System: captures the full screen.
     * Returns the path to the saved screenshot.
     */
    public async captureScreen(): Promise<string> {
        const screenshotPath = path.join(this.screenshotDir, `cu_screenshot_${Date.now()}.png`);

        if (this.context === 'browser') {
            const page = this.getPage();
            if (!page || page.isClosed()) {
                if (!robot) {
                    throw new Error('No browser page available for screenshot');
                }
                logger.warn('ComputerUse: No browser page available — falling back to system screenshot.');
                return this.captureSystemScreen(screenshotPath);
            }
            return this.captureBrowserScreen(screenshotPath);
        } else {
            return this.captureSystemScreen(screenshotPath);
        }
    }

    private async captureBrowserScreen(savePath: string): Promise<string> {
        const page = this.getPage();
        if (!page || page.isClosed()) {
            throw new Error('No browser page available for screenshot');
        }
        await page.screenshot({ path: savePath, type: 'png', fullPage: false });
        this.lastScreenshot = savePath;

        const viewport = page.viewportSize();
        if (viewport) {
            this.screenSize = { width: viewport.width, height: viewport.height };
        }

        return savePath;
    }

    /**
     * Check if a display server is available on Linux.
     * Returns false on headless servers where scrot/import/xdotool cannot work.
     */
    private hasDisplay(): boolean {
        if (this.platform === 'win32' || this.platform === 'darwin') return true;
        // Linux: need X11 or Wayland
        if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return false;
        // DISPLAY might be set but stale (e.g., old SSH session). Quick sanity check.
        try {
            execSync('xdpyinfo -display "$DISPLAY" 2>&1 | head -1', { timeout: 3000, stdio: 'pipe' });
            return true;
        } catch {
            // xdpyinfo not installed or display is bad — check if xdotool works
            try {
                execSync('xdotool getdisplaygeometry 2>&1', { timeout: 3000, stdio: 'pipe' });
                return true;
            } catch {
                return false;
            }
        }
    }

    private async captureSystemScreen(savePath: string): Promise<string> {
        try {
            // Early bail on headless Linux servers — scrot/import need X11
            if (this.platform === 'linux' && !this.hasDisplay()) {
                throw new Error('No display server available (headless server). System screenshots require X11/Wayland. Use context="browser" for browser screenshots instead, or use browser_screenshot/browser_vision for page inspection.');
            }

            // Get screen size from robotjs if available
            if (robot) {
                const size = robot.getScreenSize();
                this.screenSize = { width: size.width, height: size.height };
            }

            // Screenshots still use OS-native tools for reliable PNG output
            if (this.platform === 'win32') {
                const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bitmap = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
$bitmap.Save('${savePath.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
`;
                const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
                execSync(`powershell -NoProfile -EncodedCommand ${encoded}`, { timeout: 10000 });
            } else if (this.platform === 'darwin') {
                execSync(`screencapture -x "${savePath}"`, { timeout: 10000 });
            } else if (this.platform === 'linux') {
                try {
                    execSync(`scrot "${savePath}"`, { timeout: 10000 });
                } catch {
                    execSync(`import -window root "${savePath}"`, { timeout: 10000 });
                }
            } else {
                throw new Error(`Unsupported platform: ${this.platform}`);
            }

            this.lastScreenshot = savePath;
            return savePath;
        } catch (e) {
            throw new Error(`System screenshot failed: ${e}`);
        }
    }

    // ─── Vision-Based Element Location ──────────────────────────

    /**
     * Use vision model to locate an element on screen by description.
     * Takes a screenshot, sends to vision model with a structured prompt,
     * and parses the returned coordinates.
     */
    public async locateElement(description: string): Promise<CoordinateResult> {
        if (!this.visionAnalyzer) {
            throw new Error('Vision analyzer not configured — cannot locate elements by description');
        }

        const screenshotPath = await this.captureScreen();

        const prompt = `You are a precise UI element locator. Analyze this screenshot (${this.screenSize.width}x${this.screenSize.height} pixels) and find the element described below.

ELEMENT TO FIND: "${description}"

${this.getRegionHint(description)}

You MUST respond with ONLY a JSON object in this exact format:
{"x": <number>, "y": <number>, "confidence": "<high|medium|low>", "description": "<what you found>"}

Rules:
- x and y are pixel coordinates from the TOP-LEFT corner of the screenshot
- The coordinates should point to the CENTER of the element
- "high" confidence = clearly visible and unambiguous
- "medium" confidence = likely correct but element is partially obscured or ambiguous
- "low" confidence = best guess, element may not be visible
- If the element is NOT found at all, return: {"x": -1, "y": -1, "confidence": "low", "description": "Element not found"}

Respond with ONLY the JSON object, no other text.`;

        const response = await this.visionAnalyzer(screenshotPath, prompt);
        const primary = this.parseCoordinateResponse(response);

        if (primary.x >= 0 && primary.y >= 0 && primary.confidence !== 'low') {
            return primary;
        }

        const candidates = await this.locateElementsWithScreenshot(description, screenshotPath, 5);
        if (candidates.length === 0) {
            return primary;
        }

        const ranked = candidates.sort((a, b) => this.scoreCandidate(description, b) - this.scoreCandidate(description, a));
        const top = ranked.slice(0, 3);
        for (const candidate of top) {
            const verified = await this.verifyCandidate(description, candidate, screenshotPath);
            if (verified) {
                return candidate;
            }
        }

        return ranked[0];
    }

    /**
     * Describe what's visible on screen at given coordinates (or the full screen if no coords).
     */
    public async describeScreen(x?: number, y?: number, radius?: number): Promise<string> {
        if (!this.visionAnalyzer) {
            throw new Error('Vision analyzer not configured');
        }

        const screenshotPath = await this.captureScreen();

        let prompt: string;
        if (x !== undefined && y !== undefined) {
            const r = radius || 100;
            prompt = `Describe what is visible in this screenshot near the coordinates (${x}, ${y}) within a ${r}px radius. The screenshot is ${this.screenSize.width}x${this.screenSize.height} pixels. Focus on interactive elements (buttons, links, inputs, menus) and their current state.`;
        } else {
            prompt = `Describe this screenshot (${this.screenSize.width}x${this.screenSize.height} pixels). List all visible interactive elements (buttons, links, inputs, menus, dropdowns) and their approximate positions. Be concise but thorough.`;
        }

        return this.visionAnalyzer(screenshotPath, prompt);
    }

    /**
     * Locate multiple elements matching a description. Returns up to `limit` results.
     */
    public async locateElements(description: string, limit: number = 5): Promise<CoordinateResult[]> {
        if (!this.visionAnalyzer) {
            throw new Error('Vision analyzer not configured');
        }

        const screenshotPath = await this.captureScreen();

        return this.locateElementsWithScreenshot(description, screenshotPath, limit);
    }

    private async locateElementsWithScreenshot(description: string, screenshotPath: string, limit: number): Promise<CoordinateResult[]> {
        const prompt = `You are a precise UI element locator. Analyze this screenshot (${this.screenSize.width}x${this.screenSize.height} pixels) and find ALL elements matching the description below.

ELEMENTS TO FIND: "${description}"

${this.getRegionHint(description)}

You MUST respond with ONLY a JSON array of objects in this format:
[{"x": <number>, "y": <number>, "confidence": "<high|medium|low>", "description": "<what this specific element is>"}]

Rules:
- x and y are pixel coordinates from the TOP-LEFT corner of the screenshot pointing to the CENTER of each element
- Return up to ${limit} elements, ordered by relevance
- If NO elements are found, return: []

Respond with ONLY the JSON array, no other text.`;

        const response = await this.visionAnalyzer!(screenshotPath, prompt);
        try {
            const cleaned = response.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim();
            const parsed = JSON.parse(cleaned);
            if (Array.isArray(parsed)) {
                return parsed.map((item: any) => this.validateCoordinate(item)).filter((c: CoordinateResult) => c.x >= 0 && c.y >= 0);
            }
            return [];
        } catch {
            logger.warn(`ComputerUse: Failed to parse multi-element response: ${response.substring(0, 200)}`);
            return [];
        }
    }

    // ─── Mouse Control ──────────────────────────────────────────

    /**
     * Move the mouse to coordinates. If description is provided, uses vision to find the element.
     */
    public async mouseMove(x: number, y: number): Promise<string> {
        let result: string;
        if (this.context === 'browser') {
            result = await this.browserMouseMove(x, y);
        } else {
            result = await this.systemMouseMove(x, y);
        }
        const feedback = await this.postActionFeedback(`Moved mouse to (${x}, ${y})`);
        return result + feedback;
    }

    /**
     * Click at coordinates. If no coordinates, clicks at current mouse position.
     * If description is provided instead of coords, uses vision to locate the element.
     */
    public async mouseClick(options: {
        x?: number;
        y?: number;
        button?: 'left' | 'right' | 'middle';
        clickCount?: number;
        description?: string;
    } = {}): Promise<string> {
        let { x, y, button = 'left', clickCount = 1, description } = options;

        // Vision-based location
        if (description && (x === undefined || y === undefined)) {
            const located = await this.locateElement(description);
            if (located.x < 0 || located.y < 0) {
                return `Failed to locate "${description}" on screen. The element may not be visible.`;
            }
            x = located.x;
            y = located.y;
            logger.info(`ComputerUse: Located "${description}" at (${x}, ${y}) [${located.confidence}]`);
        }

        if (x === undefined || y === undefined) {
            return 'Error: No coordinates and no description provided for click.';
        }

        let result: string;
        if (this.context === 'browser') {
            result = await this.browserMouseClick(x, y, button, clickCount);
        } else {
            result = await this.systemMouseClick(x, y, button, clickCount);
        }
        const feedback = await this.postActionFeedback(`Clicked ${button} at (${x}, ${y})`);
        return result + feedback;
    }

    /**
     * Double-click at coordinates or at a described element.
     */
    public async mouseDoubleClick(options: { x?: number; y?: number; description?: string } = {}): Promise<string> {
        return this.mouseClick({ ...options, clickCount: 2 });
    }

    /**
     * Drag from one point to another.
     */
    public async mouseDrag(fromX: number, fromY: number, toX: number, toY: number): Promise<string> {
        let result: string;
        if (this.context === 'browser') {
            result = await this.browserMouseDrag(fromX, fromY, toX, toY);
        } else {
            result = await this.systemMouseDrag(fromX, fromY, toX, toY);
        }
        const feedback = await this.postActionFeedback(`Dragged from (${fromX}, ${fromY}) to (${toX}, ${toY})`);
        return result + feedback;
    }

    // ─── Keyboard Control ───────────────────────────────────────

    /**
     * Type text at the current cursor/focus position.
     */
    public async keyType(text: string): Promise<string> {
        let result: string;
        if (this.context === 'browser') {
            result = await this.browserKeyType(text);
        } else {
            result = await this.systemKeyType(text);
        }
        const feedback = await this.postActionFeedback(`Typed "${text.substring(0, 30)}${text.length > 30 ? '...' : ''}"`);
        return result + feedback;
    }

    /**
     * Press a key or key combination (e.g., "Enter", "ctrl+c", "alt+Tab").
     */
    public async keyPress(key: string): Promise<string> {
        let result: string;
        if (this.context === 'browser') {
            result = await this.browserKeyPress(key);
        } else {
            result = await this.systemKeyPress(key);
        }
        const feedback = await this.postActionFeedback(`Pressed key: ${key}`);
        return result + feedback;
    }

    // ─── Scroll Control ─────────────────────────────────────────

    /**
     * Scroll at a position. In browser context, scrolls the page.
     * In system context, scrolls at the current or specified mouse position.
     */
    public async scroll(direction: 'up' | 'down' | 'left' | 'right', amount: number = 3, x?: number, y?: number): Promise<string> {
        let result: string;
        if (this.context === 'browser') {
            result = await this.browserScroll(direction, amount);
        } else {
            result = await this.systemScroll(direction, amount, x, y);
        }
        const feedback = await this.postActionFeedback(`Scrolled ${direction} ${amount} ticks`);
        return result + feedback;
    }

    // ─── Composite Actions ──────────────────────────────────────

    /**
     * Vision-guided click: screenshot → find element → click it.
     * The primary computer-use interaction pattern.
     */
    public async visionClick(description: string, button: 'left' | 'right' = 'left'): Promise<string> {
        if (!this.visionAnalyzer) {
            return 'Error: Vision analyzer not configured. Cannot perform vision-guided click.';
        }

        const located = await this.locateElement(description);

        if (located.x < 0 || located.y < 0) {
            return `Could not find "${description}" on screen. Try scrolling or describing it differently.`;
        }

        if (located.confidence === 'low') {
            logger.warn(`ComputerUse: Low confidence location for "${description}" at (${located.x}, ${located.y})`);
        }

        const result = await this.mouseClick({ x: located.x, y: located.y, button });

        return `${result} (located "${description}" at ${located.x},${located.y} [${located.confidence}])`;
    }

    /**
     * Vision-guided type: screenshot → find input → click it → type text.
     */
    public async visionType(inputDescription: string, text: string): Promise<string> {
        if (!this.visionAnalyzer) {
            return 'Error: Vision analyzer not configured.';
        }

        // Locate and click the input field
        const clickResult = await this.visionClick(inputDescription);
        if (clickResult.startsWith('Could not find') || clickResult.startsWith('Error')) {
            return clickResult;
        }

        await this.sleep(200);

        // Clear existing content and type
        await this.keyPress('ctrl+a');
        await this.sleep(100);
        const typeResult = await this.keyType(text);

        return `Typed "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}" into "${inputDescription}". Click: ${clickResult}. Type: ${typeResult}`;
    }

    // ─── Browser-Context Implementations ────────────────────────

    private async browserMouseMove(x: number, y: number): Promise<string> {
        const page = this.getPage();
        if (!page || page.isClosed()) return 'Error: No browser page.';
        await page.mouse.move(x, y);
        return `Mouse moved to (${x}, ${y})`;
    }

    private async browserMouseClick(x: number, y: number, button: 'left' | 'right' | 'middle', clickCount: number): Promise<string> {
        const page = this.getPage();
        if (!page || page.isClosed()) return 'Error: No browser page.';
        await page.mouse.click(x, y, { button, clickCount });
        await this.sleep(300);
        return `Clicked ${button}${clickCount > 1 ? ` x${clickCount}` : ''} at (${x}, ${y})`;
    }

    private async browserMouseDrag(fromX: number, fromY: number, toX: number, toY: number): Promise<string> {
        const page = this.getPage();
        if (!page || page.isClosed()) return 'Error: No browser page.';
        await page.mouse.move(fromX, fromY);
        await page.mouse.down();
        // Smooth drag with intermediate steps
        const steps = Math.max(5, Math.floor(Math.hypot(toX - fromX, toY - fromY) / 20));
        await page.mouse.move(toX, toY, { steps });
        await page.mouse.up();
        return `Dragged from (${fromX}, ${fromY}) to (${toX}, ${toY})`;
    }

    private async browserKeyType(text: string): Promise<string> {
        const page = this.getPage();
        if (!page || page.isClosed()) return 'Error: No browser page.';
        await page.keyboard.type(text, { delay: 30 });
        return `Typed ${text.length} characters`;
    }

    private async browserKeyPress(key: string): Promise<string> {
        const page = this.getPage();
        if (!page || page.isClosed()) return 'Error: No browser page.';
        // Normalize key combos: "ctrl+c" → "Control+c"
        const normalized = this.normalizeKey(key);
        await page.keyboard.press(normalized);
        return `Pressed: ${key}`;
    }

    private async browserScroll(direction: 'up' | 'down' | 'left' | 'right', amount: number): Promise<string> {
        const page = this.getPage();
        if (!page || page.isClosed()) return 'Error: No browser page.';
        const pixels = amount * 120; // 120px per scroll "tick"
        const deltaX = direction === 'left' ? -pixels : direction === 'right' ? pixels : 0;
        const deltaY = direction === 'up' ? -pixels : direction === 'down' ? pixels : 0;
        await page.mouse.wheel(deltaX, deltaY);
        await this.sleep(300);
        return `Scrolled ${direction} ${amount} ticks (${pixels}px)`;
    }

    // ─── System-Context Implementations (via @jitsi/robotjs) ────

    private async systemMouseMove(x: number, y: number): Promise<string> {
        try {
            if (!robot) return 'Error: robotjs not available for system mouse control.';
            robot.moveMouse(x, y);
            return `Mouse moved to (${x}, ${y})`;
        } catch (e) {
            return `Failed to move mouse: ${e}`;
        }
    }

    private async systemMouseClick(x: number, y: number, button: 'left' | 'right' | 'middle', clickCount: number): Promise<string> {
        try {
            if (!robot) return 'Error: robotjs not available for system mouse control.';
            robot.moveMouse(x, y);
            await this.sleep(30);
            for (let i = 0; i < clickCount; i++) {
                robot.mouseClick(button);
                if (i < clickCount - 1) await this.sleep(50);
            }
            return `Clicked ${button}${clickCount > 1 ? ` x${clickCount}` : ''} at (${x}, ${y})`;
        } catch (e) {
            return `Failed to click at (${x}, ${y}): ${e}`;
        }
    }

    private async systemMouseDrag(fromX: number, fromY: number, toX: number, toY: number): Promise<string> {
        try {
            if (!robot) return 'Error: robotjs not available for system mouse control.';
            robot.moveMouse(fromX, fromY);
            await this.sleep(30);
            robot.mouseToggle('down');
            await this.sleep(30);
            // Smooth drag with intermediate steps
            const steps = Math.max(10, Math.floor(Math.hypot(toX - fromX, toY - fromY) / 10));
            for (let i = 1; i <= steps; i++) {
                const ix = Math.round(fromX + (toX - fromX) * (i / steps));
                const iy = Math.round(fromY + (toY - fromY) * (i / steps));
                robot.moveMouse(ix, iy);
                await this.sleep(5);
            }
            robot.mouseToggle('up');
            return `Dragged from (${fromX}, ${fromY}) to (${toX}, ${toY})`;
        } catch (e) {
            return `Failed to drag: ${e}`;
        }
    }

    private async systemKeyType(text: string): Promise<string> {
        try {
            if (!robot) return 'Error: robotjs not available for system keyboard control.';
            robot.typeString(text);
            return `Typed ${text.length} characters`;
        } catch (e) {
            return `Failed to type text: ${e}`;
        }
    }

    private async systemKeyPress(key: string): Promise<string> {
        try {
            if (!robot) return 'Error: robotjs not available for system keyboard control.';
            const parts = key.toLowerCase().split('+');
            const mainKey = parts.pop()!;
            const modifiers: string[] = [];
            for (const mod of parts) {
                const m = mod.trim();
                if (m === 'ctrl' || m === 'control') modifiers.push('control');
                else if (m === 'alt' || m === 'option') modifiers.push('alt');
                else if (m === 'shift') modifiers.push('shift');
                else if (m === 'cmd' || m === 'command' || m === 'meta' || m === 'super') modifiers.push('command');
                else if (m === 'win' || m === 'windows') modifiers.push('command');
            }
            const keyMap: Record<string, string> = {
                enter: 'enter', return: 'enter', tab: 'tab', escape: 'escape', esc: 'escape',
                backspace: 'backspace', delete: 'delete', del: 'delete', space: 'space',
                up: 'up', down: 'down', left: 'left', right: 'right',
                home: 'home', end: 'end', pageup: 'pageup', pagedown: 'pagedown',
                f1: 'f1', f2: 'f2', f3: 'f3', f4: 'f4', f5: 'f5', f6: 'f6',
                f7: 'f7', f8: 'f8', f9: 'f9', f10: 'f10', f11: 'f11', f12: 'f12',
                printscreen: 'printscreen', insert: 'insert', numlock: 'numlock',
                capslock: 'capslock', scrolllock: 'scrolllock',
            };
            let mappedKey = keyMap[mainKey.trim()] || mainKey.trim();
            if (mappedKey.length === 1) mappedKey = mappedKey.toLowerCase();

            if (modifiers.length === 0) {
                robot.keyTap(mappedKey);
                return `Pressed: ${key}`;
            }

            for (const mod of modifiers) {
                robot.keyToggle(mod, 'down');
            }
            await this.sleep(25);
            robot.keyTap(mappedKey);
            await this.sleep(25);
            for (const mod of modifiers.slice().reverse()) {
                robot.keyToggle(mod, 'up');
            }
            return `Pressed: ${key}`;
        } catch (e) {
            return `Failed to press ${key}: ${e}`;
        }
    }

    private async systemScroll(direction: 'up' | 'down' | 'left' | 'right', amount: number, x?: number, y?: number): Promise<string> {
        try {
            if (!robot) return 'Error: robotjs not available for system scroll control.';
            if (x !== undefined && y !== undefined) {
                robot.moveMouse(x, y);
                await this.sleep(30);
            }
            for (let i = 0; i < amount; i++) {
                if (direction === 'up') robot.scrollMouse(0, 1);
                else if (direction === 'down') robot.scrollMouse(0, -1);
                else if (direction === 'left') robot.scrollMouse(-1, 0);
                else if (direction === 'right') robot.scrollMouse(1, 0);
                if (i < amount - 1) await this.sleep(30);
            }
            return `Scrolled ${direction} ${amount} ticks`;
        } catch (e) {
            return `Failed to scroll ${direction}: ${e}`;
        }
    }

    // ─── Post-Action Visual Feedback ────────────────────────────

    /**
     * Capture a screenshot after an action and optionally describe the screen state.
     * This gives the LLM visual feedback about what happened after every action,
     * implementing the "observe → act → observe" loop that's critical for accuracy.
     * 
     * Returns a description string to append to action results. If vision is unavailable,
     * still captures a screenshot and reports the path for explicit follow-up.
     */
    private async postActionFeedback(actionDescription: string): Promise<string> {
        try {
            // Wait briefly for UI to settle after the action
            await this.sleep(400);

            const screenshotPath = await this.captureScreen();

            if (this.visionAnalyzer) {
                try {
                    const description = await this.visionAnalyzer(screenshotPath, 
                        `You just performed this action: "${actionDescription}". ` +
                        `Briefly describe (2-3 sentences max) what is NOW visible on screen. ` +
                        `Focus on: what changed, what's in focus, any dialogs/menus that appeared, ` +
                        `and what interactive elements are available for the next action. ` +
                        `Screen size: ${this.screenSize.width}x${this.screenSize.height}px.`
                    );
                    return `\n[Screen after action: ${description}]`;
                } catch (e) {
                    logger.warn(`ComputerUse: Post-action vision failed: ${e}`);
                    return `\n[Screenshot captured: ${screenshotPath} — use computer_describe to see what's on screen]`;
                }
            }

            return `\n[Screenshot captured: ${screenshotPath} — use computer_describe to see what's on screen]`;
        } catch (e) {
            logger.warn(`ComputerUse: Post-action screenshot failed: ${e}`);
            return '';
        }
    }

    // ─── Helpers ─────────────────────────────────────────────────

    private parseCoordinateResponse(response: string): CoordinateResult {
        try {
            // Strip markdown code blocks if present
            const cleaned = response.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim();

            // Try JSON parse first
            const parsed = JSON.parse(cleaned);
            return this.validateCoordinate(parsed);
        } catch {
            // Fallback: try to extract numbers from the response
            const coordMatch = response.match(/["\s]x["\s]*:\s*(\d+)[,\s]*["\s]y["\s]*:\s*(\d+)/);
            if (coordMatch) {
                return {
                    x: parseInt(coordMatch[1]),
                    y: parseInt(coordMatch[2]),
                    confidence: 'low',
                    description: 'Parsed from non-JSON response'
                };
            }

            logger.warn(`ComputerUse: Could not parse coordinates from: ${response.substring(0, 200)}`);
            return { x: -1, y: -1, confidence: 'low', description: 'Failed to parse response' };
        }
    }

    private getRegionHint(description: string): string {
        const d = description.toLowerCase();
        const hints: string[] = [];

        if (d.includes('left')) hints.push('Prefer elements on the LEFT side of the screen (lower x).');
        if (d.includes('right')) hints.push('Prefer elements on the RIGHT side of the screen (higher x).');
        if (d.includes('top') || d.includes('upper')) hints.push('Prefer elements near the TOP of the screen (lower y).');
        if (d.includes('bottom') || d.includes('lower')) hints.push('Prefer elements near the BOTTOM of the screen (higher y).');
        if (d.includes('sidebar') || d.includes('left sidebar') || d.includes('folders')) {
            hints.push('If this is a sidebar list, prefer items in the left 20-30% width of the screen.');
        }
        if (d.includes('address bar') || d.includes('path bar') || d.includes('location bar')) {
            hints.push('Address/location bars are typically near the top and span wide horizontally.');
        }
        if (d.includes('toolbar') || d.includes('ribbon')) {
            hints.push('Toolbars/ribbons are typically at the top of the window.');
        }
        if (d.includes('taskbar')) {
            hints.push('Taskbar is typically along the bottom edge of the screen.');
        }

        if (hints.length === 0) return '';
        return `REGION HINTS:\n- ${hints.join('\n- ')}`;
    }

    private scoreCandidate(description: string, candidate: CoordinateResult): number {
        const d = description.toLowerCase();
        const x = this.screenSize.width > 0 ? candidate.x / this.screenSize.width : 0.5;
        const y = this.screenSize.height > 0 ? candidate.y / this.screenSize.height : 0.5;

        let score = 0;
        if (candidate.confidence === 'high') score += 3;
        if (candidate.confidence === 'medium') score += 1;

        if (d.includes('left')) score += (1 - x) * 2;
        if (d.includes('right')) score += x * 2;
        if (d.includes('top') || d.includes('upper')) score += (1 - y) * 2;
        if (d.includes('bottom') || d.includes('lower')) score += y * 2;
        if (d.includes('sidebar') || d.includes('folders')) score += (1 - x) * 2;
        if (d.includes('address bar') || d.includes('path bar') || d.includes('location bar')) score += (1 - y) * 2;
        if (d.includes('toolbar') || d.includes('ribbon')) score += (1 - y) * 1.5;
        if (d.includes('taskbar')) score += y * 2;

        return score;
    }

    private async verifyCandidate(description: string, candidate: CoordinateResult, screenshotPath: string): Promise<boolean> {
        if (!this.visionAnalyzer) return false;

        const prompt = `You are verifying a UI element at a specific location.

TARGET DESCRIPTION: "${description}"
PROPOSED COORDINATES: x=${candidate.x}, y=${candidate.y}
SCREEN SIZE: ${this.screenSize.width}x${this.screenSize.height}

Check the screenshot and focus on the small region around the proposed coordinates (about a 120px radius). Decide if the target description matches what is there.

Respond with ONLY a JSON object in this exact format:
{"match": true|false, "note": "short reason"}
`;

        try {
            const response = await this.visionAnalyzer(screenshotPath, prompt);
            const cleaned = response.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim();
            const parsed = JSON.parse(cleaned);
            return parsed?.match === true;
        } catch (e) {
            logger.warn(`ComputerUse: Candidate verification failed: ${e}`);
            return false;
        }
    }

    private validateCoordinate(parsed: any): CoordinateResult {
        const x = typeof parsed.x === 'number' ? parsed.x : parseInt(parsed.x) || -1;
        const y = typeof parsed.y === 'number' ? parsed.y : parseInt(parsed.y) || -1;
        const confidence = ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'low';
        return { x, y, confidence: confidence as CoordinateResult['confidence'], description: parsed.description || '' };
    }

    private normalizeKey(key: string): string {
        // "ctrl+c" → "Control+c", "alt+tab" → "Alt+Tab", "cmd+v" → "Meta+v"
        return key.split('+').map((part, i, arr) => {
            const lower = part.trim().toLowerCase();
            if (i < arr.length - 1) {
                // Modifier
                switch (lower) {
                    case 'ctrl': case 'control': return 'Control';
                    case 'alt': case 'option': return 'Alt';
                    case 'shift': return 'Shift';
                    case 'cmd': case 'command': case 'meta': case 'super': return 'Meta';
                    default: return part.trim();
                }
            }
            // Main key — capitalize special keys
            switch (lower) {
                case 'enter': case 'return': return 'Enter';
                case 'tab': return 'Tab';
                case 'escape': case 'esc': return 'Escape';
                case 'space': return 'Space';
                case 'backspace': return 'Backspace';
                case 'delete': case 'del': return 'Delete';
                case 'up': return 'ArrowUp';
                case 'down': return 'ArrowDown';
                case 'left': return 'ArrowLeft';
                case 'right': return 'ArrowRight';
                case 'home': return 'Home';
                case 'end': return 'End';
                case 'pageup': return 'PageUp';
                case 'pagedown': return 'PageDown';
                default: return part.trim();
            }
        }).join('+');
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Clean up old screenshots (keep last 5).
     */
    public cleanup(): void {
        try {
            const files = fs.readdirSync(this.screenshotDir)
                .filter(f => f.startsWith('cu_screenshot_') && f.endsWith('.png'))
                .sort()
                .reverse();

            for (const file of files.slice(5)) {
                fs.unlinkSync(path.join(this.screenshotDir, file));
            }
        } catch { /* ignore cleanup errors */ }
    }
}
