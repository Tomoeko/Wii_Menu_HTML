"""AES-CBC through the application's existing Node runtime, with no pip packages."""

from pathlib import Path
import shutil
import struct
import subprocess


class AesCbc:
    """Reuse a private pipe-based worker across many NAND clusters or WAD contents."""

    def __enter__(self):
        node = shutil.which("node")
        if node is None:
            raise RuntimeError("AES decryption requires the application's Node.js 20+ runtime")
        self.process = subprocess.Popen(
            [node, str(Path(__file__).with_name("aes_bridge.mjs"))],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        return self

    def crypt(self, data, key, iv, *, decrypt=True):
        if len(key) != 16 or len(iv) != 16 or len(data) % 16:
            raise ValueError("AES-CBC requires 16-byte key/IV and whole blocks")
        result = bytearray()
        # Keep pipe requests bounded. CBC continues from the last ciphertext
        # block when a large WAD content spans multiple requests.
        for offset in range(0, len(data), 1024 * 1024):
            chunk = data[offset : offset + 1024 * 1024]
            header = bytes([int(decrypt)]) + key + iv + struct.pack(">I", len(chunk))
            try:
                self.process.stdin.write(header + chunk)
                self.process.stdin.flush()
                decoded = self.process.stdout.read(len(chunk))
            except (BrokenPipeError, OSError) as error:
                raise RuntimeError("The local AES worker stopped unexpectedly") from error
            if len(decoded) != len(chunk):
                raise RuntimeError("The local AES worker returned incomplete data")
            result.extend(decoded)
            iv = bytes(chunk[-16:] if decrypt else decoded[-16:])
        return bytes(result)

    def __exit__(self, *exception):
        self.process.stdin.close()
        self.process.stdout.close()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()


def aes_cbc_decrypt(data, key, iv):
    with AesCbc() as context:
        return context.crypt(data, key, iv)
