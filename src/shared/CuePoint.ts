export default class CuePoint {
    index: number;
    position: number;
    color: string | undefined;

    constructor({ index, position, color }: { index: number, position: number, color?: string }) {
        this.index = index;
        this.position = position;
        this.color = color;
    }
}
