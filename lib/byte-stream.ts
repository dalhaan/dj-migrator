class ByteStream {
    buffer: Buffer;
    index: number;

    constructor(buffer: Buffer) {
        this.buffer = buffer;
        this.index = 0;
    }

    read(size: number): Buffer | null {
        if (this.buffer.length >= this.index + size) {
            // TODO: change to slice to avoid pointless convert to string and back
            const bytesString = this.buffer.toString('hex', this.index, this.index + size);

            this.index += size;

            return Buffer.from(bytesString, 'hex');
        }

        return null;
    }

    lookahead(size: number): Buffer | null {
        if (this.buffer.length >= this.index + size) {
            // TODO: change to slice to avoid pointless convert to string and back
            const bytesString = this.buffer.toString('hex', this.index, this.index + size);

            return Buffer.from(bytesString, 'hex');
        }

        return null;
    }
}

/**
 * TODO: to replace with normal export (export default) once all files that
 * reference ByteStream have been converted to TypeScript
 */
export default ByteStream;
