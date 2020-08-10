class ByteStream {
    constructor(buffer) {
        this.buffer = buffer;
        this.index = 0;
    }

    read(size) {
        if (this.buffer.length >= this.index + size) {
            const bytesString = this.buffer.toString('hex', this.index, this.index + size);

            this.index += size;

            return Buffer.from(bytesString, 'hex');
        }

        return null;
    }
}

module.exports = ByteStream;
