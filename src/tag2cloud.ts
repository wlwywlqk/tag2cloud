export interface Options {
    width: number;
    height: number;
    maskImage: string | false | null | undefined;
    pixelRatio: number;
    lightThreshold: number;
    opacityThreshold: number;
    minFontSize: number;
    maxFontSize: number;
    angleFrom: number;
    angleTo: number;
    angleCount: number;
    family: string;
    cut: boolean;
    padding: number;
    canvas: boolean;
}

export interface Tag {
    text: string;
    weight: number;
    angle?: number;
    color?: string;
}

export interface Pixels {
    width: number;
    height: number;
    data: number[][];
}

export interface TagData extends Required<Tag> {
    angle: number;
    fontSize: number;
    x: number;
    y: number;
    rendered: boolean;
}

const ZERO_STR = "00000000000000000000000000000000";
const TIMEOUT_MS = 100;
export class Tag2Cloud {
    private readonly defaultOptions: Options = {
        width: 200,
        height: 200,
        maskImage: false,
        pixelRatio: 4,
        lightThreshold: ((255 * 3) / 2) >> 0,
        opacityThreshold: 255,
        minFontSize: 10,
        maxFontSize: 100,
        angleFrom: -60,
        angleTo: 60,
        angleCount: 3,
        family: "sans-serif",
        cut: false,
        padding: 5,
        canvas: false,
    };
    options: Options;
    private $container: HTMLElement;
    private $wrapper: HTMLElement;
    private $canvas: HTMLCanvasElement;
    private $displayCanvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private displayCtx: CanvasRenderingContext2D;

    private listeners: Function[] = [];

    private pixels: Pixels = {
        width: 0,
        height: 0,
        data: []
    };

    private maxTagWeight = 0;
    private minTagWeight = Infinity;

    private promised: Promise<void> = Promise.resolve();
    constructor($container: HTMLElement, options?: Partial<Options>) {
        this.$container = $container;
        if (getComputedStyle(this.$container).position === "static") {
            this.$container.style.position = "relative";
        }

        this.options = {
            ...this.defaultOptions,
            ...options
        };
        this.options.pixelRatio = Math.round(Math.max(this.options.pixelRatio, 1));

        const { width, height } = this.options;

        this.$container.style.width = `${width}px`;
        this.$container.style.height = `${height}px`;

        this.$wrapper = document.createElement("div");
        this.$wrapper.style.width = '0px';
        this.$wrapper.style.height = '0px';

        this.$canvas = document.createElement("canvas");
        this.$canvas.width = width;
        this.$canvas.height = height;
        this.$canvas.style.display = "none";

        this.$displayCanvas = document.createElement("canvas");
        this.$displayCanvas.width = width;
        this.$displayCanvas.height = height;

        this.ctx = this.$canvas.getContext("2d")!;
        this.ctx.textAlign = "center";

        this.displayCtx = this.$displayCanvas.getContext("2d")!;
        this.displayCtx.textAlign = "center";

        this.$container.classList.add("tag2cloud");
        this.$container.append(this.$canvas);
        this.$container.append(this.$displayCanvas);
        this.$container.append(this.$wrapper);

        this.initPixels();
    }

    public async draw(tags: Tag[] = []): Promise<TagData[]> {
        if (tags.length === 0) return [];
        await this.promised;
        for (let i = 0, len = tags.length; i < len; i++) {
            const { weight } = tags[i];
            if (weight > this.maxTagWeight) {
                this.maxTagWeight = weight;
            }
            if (weight < this.minTagWeight) {
                this.minTagWeight = weight;
            }
        }
        const result = await this.performDraw(tags);
        return result;
    }

    public clear() {
        const { width, height } = this.options;
        this.$wrapper.innerHTML = '';
        this.displayCtx.clearRect(0, 0, width, height);
        this.initPixels();
    }

    public destory() {
        if (this.$container) {
            this.$container.removeChild(this.$canvas);
        }
    }

    public shape(cb: (ctx: CanvasRenderingContext2D) => void) {
        const { width, height } = this.options;
        this.ctx.clearRect(0, 0, width, height);
        this.ctx.textAlign = "left";
        cb(this.ctx);
        this.ctx.textAlign = "center";
        const imgData = this.ctx.getImageData(0, 0, width, width);
        this.pixels = this.getPixelsFromImgData(imgData, 2, 255 * 3, -1, false);
    }


    public onClick(listener: Function): () => void {
        if (listener instanceof Function) {
            this.listeners.push(listener);
            return () => {
                this.offClick(listener);
            };
        }
        return () => { };
    }

    public offClick(listener: Function) {
        const index = this.listeners.indexOf(listener);
        if (index !== -1) {
            this.listeners.splice(index, 1);
        }
    }

    public getCtx(): CanvasRenderingContext2D {
        return this.ctx;
    }

    private initPixels() {
        const { width, height, maskImage } = this.options;
        if (maskImage) {
            const $img: HTMLImageElement = new Image();
            this.promised = new Promise((resolve, reject) => {
                $img.onload = () => {
                    this.pixels = this.loadMaskImage($img);
                    resolve();
                };
                $img.onerror = reject;
            });
            $img.crossOrigin = "anonymous";
            $img.src = maskImage;
        } else {
            this.pixels = this.generatePixels(width, height, 0, false);
        }
    }

    private async performDraw(tags: Tag[] = []): Promise<TagData[]> {
        const sortTags = tags.sort((a, b) => b.weight - a.weight);
        const result: TagData[] = [];
        let partial: TagData[] = [];

        let expired = performance.now() + TIMEOUT_MS;
        for (let i = 0, len = sortTags.length; i < len; i++) {
            const tagData = this.handleTag(sortTags[i]);
            const now = performance.now();
            result.push(tagData);
            partial.push(tagData);
            if (now > expired) {
                this.layout(partial);
                partial = [];
                await new Promise((r) => { setTimeout(r); });
                expired = now + TIMEOUT_MS;
            }

        }
        this.layout(partial);
        return result;
    }

    private layout(data: TagData[]): void {
        if (this.options.canvas) {
            this.layoutByCanvas(data);
        } else {
            this.layoutByDom(data);
        }
    }

    private layoutByCanvas(data: TagData[]) {
        const { family } = this.options;
        for (let i = 0, len = data.length; i < len; i++) {
            const current = data[i];
            if (!current.rendered) continue;
            const { angle, color, fontSize, text, x, y } = current;
            this.displayCtx.save();
            const theta = (-angle * Math.PI) / 180;
            this.displayCtx.font = `${fontSize}px ${family}`;
            const textMetrics: TextMetrics = this.displayCtx.measureText(text);
            const {
                fontBoundingBoxAscent,
                fontBoundingBoxDescent,
            } = textMetrics;
            const height = fontBoundingBoxAscent + fontBoundingBoxDescent;

            this.displayCtx.translate(x, y);
            this.displayCtx.rotate(theta);
            this.displayCtx.fillStyle = color;

            this.displayCtx.fillText(text, 0, height / 2 - fontBoundingBoxDescent);
            this.displayCtx.restore();
        }
    }

    private layoutByDom(data: TagData[]) {
        const fragment = document.createDocumentFragment();
        for (let i = 0, len = data.length; i < len; i++) {
            const current = data[i];
            if (!current.rendered) continue;
            const $tag = document.createElement("span");
            fragment.append($tag);
            $tag.innerText = current.text;
            $tag.style.color = current.color;
            $tag.style.justifyContent = "center";
            $tag.style.alignItems = "center";
            $tag.style.lineHeight = "normal";
            $tag.style.fontSize = `${current.fontSize}px`;
            $tag.style.position = "absolute";
            $tag.style.transform = `translate(calc(-50%), calc(-50%)) rotate(${-current.angle}deg)`;
            $tag.style.left = `${current.x}px`;
            $tag.style.top = `${current.y}px`;
            $tag.style.fontFamily = `${this.options.family}`;
            $tag.style.whiteSpace = "pre";

            $tag.classList.add("tag2cloud__tag");
            $tag.addEventListener("click", this.click.bind(this, current));
        }

        this.$wrapper.append(fragment);
    }

    private click(tagData: TagData) {
        this.listeners.forEach((fn: Function) => {
            fn(tagData);
        });
    }

    private generatePixels(
        width: number,
        height: number,
        fill: -1 | 0 = 0,
        forTag: boolean = true
    ): Pixels {
        const { pixelRatio, cut } = this.options;
        const pixelXLength = Math.ceil(width / pixelRatio);
        const pixelYLength = Math.ceil(height / pixelRatio);
        const data = [];

        const len = Math.ceil(pixelXLength / 32);
        const tailOffset = pixelXLength % 32;
        const tailFill =
            forTag || tailOffset === 0
                ? fill
                : cut
                    ? fill & (-1 << (32 - tailOffset))
                    : fill | (-1 >>> tailOffset);

        for (let i = 0; i < pixelYLength; i++) {
            const xData = new Array(len).fill(fill);
            xData[len - 1] = tailFill;
            data.push(xData);
        }
        return {
            width,
            height,
            data
        };
    }

    private handleTag(tag: Tag): TagData {
        const { minTagWeight, maxTagWeight } = this;
        const {
            minFontSize,
            maxFontSize,
            angleCount,
            angleFrom,
            angleTo,
            padding
        } = this.options;
        const { text, weight, angle: maybeAngle, color: maybeColor } = tag;

        const diffWeight = maxTagWeight - minTagWeight;
        const fontSize =
            diffWeight > 0
                ? Math.round(
                    minFontSize +
                    (maxFontSize - minFontSize) *
                    ((weight - minTagWeight) / diffWeight)
                )
                : Math.round((maxFontSize + minFontSize) / 2);

        const randomNum = (Math.random() * angleCount) >> 0;
        const angle =
            maybeAngle === undefined
                ? angleCount === 1
                    ? angleFrom
                    : angleFrom + (randomNum / (angleCount - 1)) * (angleTo - angleFrom)
                : maybeAngle;

        const color =
            maybeColor === undefined
                ? "#" +
                (((0xffff00 * Math.random()) >> 0) + 0x1000000).toString(16).slice(1)
                : maybeColor;

        const pixels = this.getTagPixels({
            text,
            angle,
            fontSize,
            color,
            padding
        });

        const result: TagData = {
            text,
            weight,
            fontSize,
            angle,
            color,
            x: NaN,
            y: NaN,
            rendered: false
        };
        if (pixels === null) return result;

        const [x, y] = this.placeTag(pixels);
        if (!isNaN(x)) {
            result.x = (x + pixels.width / 2) >> 0;
            result.y = (y + pixels.height / 2) >> 0;
            result.rendered = true;
            this.ctx.save();
        }

        return result;
    }

    private placeTag(pixels: Pixels): [number, number] {
        const { width, height, pixelRatio } = this.options;

        // const startX = Math.random() * width >> 0;
        // const startY = Math.random() * height >> 0;

        const startX = ((width - pixels.width) / 2) >> 0;
        const startY = ((height - pixels.height) / 2) >> 0;

        const endLen =
            (Math.max(startX, width - startX, startY, height - startY) / pixelRatio +
                1) >>
            0;

        let x = startX;
        let y = startY;

        if (this.tryPlaceTag(pixels, x, y)) {
            return [x, y];
        }

        let step = 1;

        let xDir = Math.random() < 0.5 ? 1 : -1;
        let yDir = Math.random() < 0.5 ? 1 : -1;
        const { width: pixelsWidth, height: pixelsHeight } = pixels;

        const whRate = height / width;
        while (step >> 1 < endLen) {
            let rest = step;
            if (y < -pixelsHeight || y > height) {
                x += xDir * pixelRatio * rest;
            } else
                while (rest--) {
                    x += xDir * pixelRatio;
                    if (x < -pixelsWidth || x > width) continue;
                    if (this.tryPlaceTag(pixels, x, y)) {
                        return [x, y];
                    }
                }

            xDir = -xDir;
            rest = (step * whRate) >> 0;

            if (x < -pixelsWidth || x > width) {
                y += yDir * pixelRatio * rest;
            } else
                while (rest--) {
                    y += yDir * pixelRatio;
                    if (y < -pixelsHeight || y > height) continue;

                    if (this.tryPlaceTag(pixels, x, y)) {
                        return [x, y];
                    }
                }

            yDir = -yDir;
            step++;
        }
        return [NaN, NaN];
    }

    private tryPlaceTag(pixels: Pixels, x: number, y: number): boolean {
        const { pixelRatio, cut } = this.options;
        const { data } = pixels;
        const { data: thisData } = this.pixels;
        const pixelsX = Math.floor(x / pixelRatio);
        const pixelsY = Math.floor(y / pixelRatio);
        const offset = pixelsX % 32;
        const fix = offset ? -1 : 0;
        const xx = Math.floor(pixelsX / 32);
        const out = cut ? 0 : -1;

        for (let i = 0, len = data.length; i < len; i++) {
            const yData =
                thisData[pixelsY + i] === undefined ? [] : thisData[pixelsY + i];
            for (let j = 0, len = data[i].length; j < len; j++) {
                const current = yData[xx + j] === undefined ? out : yData[xx + j];
                const next =
                    (yData[xx + j + 1] === undefined ? out : yData[xx + j + 1]) & fix;
                if (((current << offset) | (next >>> (32 - offset))) & data[i][j]) {
                    return false;
                }
            }
        }

        for (let i = 0, len = data.length; i < len; i++) {
            const yData =
                thisData[pixelsY + i] === undefined ? [] : thisData[pixelsY + i];
            for (let j = 0, len = data[i].length; j < len; j++) {
                const target = data[i][j];
                if (yData[xx + j] !== undefined) {
                    yData[xx + j] |= target >>> offset;
                }
                if (yData[xx + j + 1] !== undefined && offset) {
                    yData[xx + j + 1] |= target << (32 - offset);
                }
            }
        }
        return true;
    }

    private getTagPixels({
        text,
        angle,
        fontSize,
        color,
        padding
    }: {
        text: string;
        angle: number;
        fontSize: number;
        color: string;
        padding: number;
    }): null | Pixels {
        this.ctx.save();
        const theta = (-angle * Math.PI) / 180;
        const cosTheta = Math.cos(theta);
        const sinTheta = Math.sin(theta);
        this.ctx.font = `${fontSize}px ${this.options.family}`;
        const textMetrics: TextMetrics = this.ctx.measureText(text);
        const {
            fontBoundingBoxAscent,
            fontBoundingBoxDescent,
            width
        } = textMetrics;
        const height = fontBoundingBoxAscent + fontBoundingBoxDescent;

        const widthWithPadding = width + padding;
        const heightWithPadding = height + padding;

        const pixelWidth =
            (Math.abs(heightWithPadding * sinTheta) +
                Math.abs(widthWithPadding * cosTheta)) >>
            0;
        const pixelHeight =
            (Math.abs(heightWithPadding * cosTheta) +
                Math.abs(widthWithPadding * sinTheta)) >>
            0;

        if (pixelHeight > this.options.height || pixelWidth > this.options.width) {
            return null;
        }
        this.ctx.clearRect(0, 0, pixelWidth, pixelHeight);

        this.ctx.translate(pixelWidth / 2, pixelHeight / 2);
        this.ctx.rotate(theta);
        this.ctx.fillStyle = color;
        this.ctx.lineWidth = padding;

        this.ctx.strokeText(text, 0, height / 2 - fontBoundingBoxDescent);
        this.ctx.fillText(text, 0, height / 2 - fontBoundingBoxDescent);
        this.ctx.restore();

        const imgData: ImageData = this.ctx.getImageData(
            0,
            0,
            pixelWidth,
            pixelHeight
        );

        return this.getPixelsFromImgData(imgData, 2, 255 * 3);
    }
    private getPixelsFromImgData(
        imgData: ImageData,
        opacityThreshold: number,
        lightThreshold: number,
        fill: 0 | -1 = 0,
        forTag: boolean = true
    ): Pixels {
        const { pixelRatio, cut } = this.options;
        const { data, width, height } = imgData;
        const pixels = this.generatePixels(width, height, fill, forTag);
        const { data: pixelsData } = pixels;

        const dataXLength = width << 2;

        const pixelXLength = Math.ceil(width / pixelRatio);
        const pixelYLength = Math.ceil(height / pixelRatio);
        let pixelCount = pixelXLength * pixelYLength;

        let pixelX = 0;
        let pixelY = 0;

        const edgeXLength = width % pixelRatio || pixelRatio;
        const edgeYLength = height % pixelRatio || pixelRatio;
        while (pixelCount--) {
            const outerOffset =
                pixelY * pixelRatio * dataXLength + ((pixelX * pixelRatio) << 2);
            const xLength = pixelX === pixelXLength - 1 ? edgeXLength : pixelRatio;
            const yLength = pixelY === pixelYLength - 1 ? edgeYLength : pixelRatio;
            const xIndex = (pixelX / 32) >> 0;

            let y = 0;
            outer: while (y < yLength) {
                let x = 0;

                const offset = outerOffset + y++ * dataXLength;
                while (x < xLength) {
                    const pos = offset + (x++ << 2);
                    const opacity = data[pos + 3];
                    if (opacity < opacityThreshold) {
                        continue;
                    }
                    const light = data[pos] + data[pos + 1] + data[pos + 2];
                    if (light > lightThreshold) {
                        continue;
                    }

                    if (fill) {
                        pixelsData[pixelY][xIndex] &= ~(1 << -(pixelX + 1));
                    } else {
                        pixelsData[pixelY][xIndex] |= 1 << -(pixelX + 1);
                    }

                    break outer;
                }
            }

            pixelX++;
            if (pixelX === pixelXLength) {
                pixelX = 0;
                pixelY++;
            }
        }
        return {
            width,
            height,
            data: pixelsData
        };
    }

    private loadMaskImage($maskImage: HTMLImageElement): Pixels {
        const { width, height, opacityThreshold, lightThreshold } = this.options;

        this.ctx.clearRect(0, 0, width, height);
        this.ctx.drawImage($maskImage, 0, 0, width, height);
        const imgData = this.ctx.getImageData(0, 0, width, height);
        const pixels = this.getPixelsFromImgData(
            imgData,
            opacityThreshold,
            lightThreshold,
            -1,
            false
        );

        return pixels;
    }
    private printPixels(pixels: Pixels | null): void {
        if (pixels === null) return;
        for (let i = 0, len = pixels.data.length; i < len; i++) {
            console.log(pixels.data[i].map(this.binaryStrIfy).join("") + "_" + i);
        }
    }
    private binaryStrIfy(num: number): string {
        if (num >= 0) {
            const numStr = num.toString(2);
            return ZERO_STR.slice(0, 32 - numStr.length) + numStr;
        }
        return (Math.pow(2, 32) + num).toString(2);
    }
}
