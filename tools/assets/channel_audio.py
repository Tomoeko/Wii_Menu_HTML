"""Decode channel banner BNS and uncompressed RIFF/WAVE without external tools.

BNS offsets are checked against the supplied channel resources: references in
INFO are relative to its payload after the eight-byte block header, and sample
offsets are relative to the DATA payload. BNS stores loop points in samples,
not DSP nibble addresses.
The shared DSP decoder preserves the source predictor histories and saturation.
"""

from __future__ import annotations

from array import array
from dataclasses import dataclass
import math
import struct

from export_audio import decode_dsp


MAX_SAMPLES = 20_000_000
MAX_RESOURCE_BYTES = 128 * 1024 * 1024


@dataclass
class ChannelAudio:
    pcm: list[array]
    sample_rate: int
    source_format: str
    loop_start: int | None = None
    loop_end: int | None = None

    @property
    def sample_count(self):
        return len(self.pcm[0])

    def metadata(self):
        result = {
            "sampleRate": self.sample_rate,
            "channels": len(self.pcm),
            "samples": self.sample_count,
            "duration": self.sample_count / self.sample_rate,
            "loop": self.loop_start is not None,
        }
        if self.loop_start is not None:
            result["loopStart"] = self.loop_start / self.sample_rate
            result["loopEnd"] = self.loop_end / self.sample_rate
        return result


def require_range(data, offset, size, description):
    if offset < 0 or size < 0 or offset + size > len(data):
        raise ValueError(f"Truncated or invalid {description}")
    return memoryview(data)[offset : offset + size]


def validate_audio(channels, rate, samples):
    if channels not in (1, 2):
        raise ValueError("Channel audio must contain one or two audio channels")
    if not 1 <= rate <= 192000:
        raise ValueError("Invalid channel audio sample rate")
    if not 1 <= samples <= MAX_SAMPLES:
        raise ValueError("Invalid or excessive channel audio sample count")


def decode_bns(data):
    """Read the BNS 1.0 DSP ADPCM variant present in original channel banners."""
    require_range(data, 0, 32, "BNS header")
    if data[:8] != b"BNS \xfe\xff\x01\x00":
        raise ValueError("Expected big-endian BNS version 1.0")
    size, header_size, block_count = struct.unpack_from(">IHH", data, 8)
    if size != len(data) or header_size != 32 or block_count != 2:
        raise ValueError("Invalid BNS size, header, or block count")

    blocks = []
    for index, name in enumerate((b"INFO", b"DATA")):
        offset, length = struct.unpack_from(">II", data, 16 + index * 8)
        block = require_range(data, offset, length, f"BNS {name.decode()} block")
        if offset < header_size or length < 8 or bytes(block[:4]) != name:
            raise ValueError(f"Invalid BNS {name.decode()} block header")
        if struct.unpack_from(">I", block, 4)[0] != length:
            raise ValueError(f"Inconsistent BNS {name.decode()} block size")
        blocks.append((offset, length, block[8:]))
    info_offset, info_length, info = blocks[0]
    data_offset, _, encoded = blocks[1]
    if info_offset + info_length > data_offset:
        raise ValueError("Overlapping BNS INFO and DATA blocks")

    require_range(info, 0, 24, "BNS stream metadata")
    codec, looping, channels = info[:3]
    if codec != 0:
        raise ValueError(f"Unsupported BNS codec {codec}; expected DSP ADPCM")
    if looping not in (0, 1):
        raise ValueError("Invalid BNS loop flag")
    rate = struct.unpack_from(">H", info, 4)[0]
    loop_start, count, table_offset = struct.unpack_from(">III", info, 8)
    validate_audio(channels, rate, count)
    if looping and loop_start >= count:
        raise ValueError("BNS loop start must precede the sample count")
    table = require_range(info, table_offset, channels * 4, "BNS channel table")
    pcm = []
    byte_count = (count + 13) // 14 * 8
    for channel in range(channels):
        entry_offset = struct.unpack_from(">I", table, channel * 4)[0]
        entry = require_range(info, entry_offset, 12, "BNS channel entry")
        sample_offset, context_offset = struct.unpack_from(">II", entry)
        context = require_range(info, context_offset, 48, "BNS DSP context")
        coefficients = struct.unpack_from(">16h", context)
        history1, history2 = struct.unpack_from(">2h", context, 36)
        samples = require_range(encoded, sample_offset, byte_count, "BNS DSP samples")
        pcm.append(decode_dsp(samples, count, coefficients, history1, history2))
    return ChannelAudio(
        pcm,
        rate,
        "BNS 1.0 DSP ADPCM",
        loop_start if looping else None,
        count if looping else None,
    )


def riff_chunks(data):
    require_range(data, 0, 12, "RIFF/WAVE header")
    if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise ValueError("Expected little-endian RIFF/WAVE")
    end = 8 + struct.unpack_from("<I", data, 4)[0]
    if end < 12 or end > len(data):
        raise ValueError("Truncated or invalid RIFF/WAVE length")
    contents = memoryview(data)[:end]
    offset = 12
    while offset < end:
        header = require_range(contents, offset, 8, "RIFF chunk header")
        size = struct.unpack_from("<I", header, 4)[0]
        payload = require_range(contents, offset + 8, size, "RIFF chunk payload")
        yield bytes(header[:4]), payload
        offset += 8 + size + (size & 1)
        if offset > end:
            raise ValueError("Truncated RIFF chunk padding")


def decode_wave(data):
    """Convert integer PCM or IEEE float WAVE to signed 16-bit browser PCM.

    An optional forward `smpl` loop is retained. Its inclusive last sample is
    converted to the exclusive Web Audio end boundary without adding any loops.
    Unknown metadata chunks are retained in the input only and do not affect PCM.
    """
    chunks = {}
    for kind, payload in riff_chunks(data):
        if kind in (b"fmt ", b"data", b"smpl"):
            if kind in chunks:
                raise ValueError(f"Duplicate RIFF {kind.decode().strip()} chunk")
            chunks[kind] = payload
    if b"fmt " not in chunks or b"data" not in chunks:
        raise ValueError("RIFF/WAVE needs fmt and data chunks")
    format_data = require_range(chunks[b"fmt "], 0, 16, "WAVE format")
    codec, channels, rate, byte_rate, alignment, bits = struct.unpack("<HHIIHH", format_data)
    if codec == 0xFFFE:
        extension = require_range(chunks[b"fmt "], 16, 24, "WAVE extensible format")
        extension_size, valid_bits, channel_mask = struct.unpack_from("<HHI", extension)
        subtype = bytes(extension[8:24])
        if extension_size < 22 or valid_bits not in (0, bits):
            raise ValueError("Unsupported WAVE extensible sample precision")
        if channel_mask not in (0, 4 if channels == 1 else 3):
            raise ValueError("Unsupported WAVE extensible channel order")
        if subtype[4:] != bytes.fromhex("00001000800000aa00389b71"):
            raise ValueError("Unsupported WAVE extensible codec identifier")
        codec = int.from_bytes(subtype[:4], "little")
    if codec == 1 and bits not in (8, 16, 24, 32):
        raise ValueError("Integer WAVE must use 8, 16, 24, or 32 bits")
    if codec == 3 and bits not in (32, 64):
        raise ValueError("Floating-point WAVE must use 32 or 64 bits")
    if codec not in (1, 3):
        raise ValueError(f"Unsupported WAVE codec {codec}; use uncompressed PCM or float")
    width = bits // 8
    if alignment != channels * width or byte_rate != rate * alignment:
        raise ValueError("Inconsistent WAVE block alignment or byte rate")
    encoded = chunks[b"data"]
    if not alignment or len(encoded) % alignment:
        raise ValueError("Truncated WAVE audio frame")
    count = len(encoded) // alignment
    validate_audio(channels, rate, count)
    pcm = [array("h") for _ in range(channels)]
    for frame in range(count):
        for channel in range(channels):
            offset = frame * alignment + channel * width
            raw = encoded[offset : offset + width]
            if codec == 3:
                value = struct.unpack("<f" if bits == 32 else "<d", raw)[0]
                if not math.isfinite(value):
                    raise ValueError("WAVE audio contains a non-finite sample")
                sample = round(max(-1.0, min(1.0, value)) * 32768)
            elif bits == 8:
                sample = (raw[0] - 128) * 256
            else:
                sample = int.from_bytes(raw, "little", signed=True) >> (bits - 16)
            pcm[channel].append(max(-32768, min(32767, sample)))

    loop_start = loop_end = None
    if b"smpl" in chunks:
        sampler = chunks[b"smpl"]
        require_range(sampler, 0, 36, "WAVE sampler metadata")
        loop_count = struct.unpack_from("<I", sampler, 28)[0]
        if loop_count > 1:
            raise ValueError("WAVE supports one forward loop per channel sound")
        if loop_count:
            record = require_range(sampler, 36, 24, "WAVE sampler loop")
            _, loop_type, loop_start, last_sample, fraction, play_count = struct.unpack(
                "<6I", record
            )
            loop_end = last_sample + 1
            if loop_type != 0 or fraction != 0 or play_count != 0:
                raise ValueError("WAVE loop must be an infinite, integral forward loop")
            if not 0 <= loop_start < loop_end <= count:
                raise ValueError("WAVE loop must stay inside its audio samples")
    source_format = f"RIFF/WAVE {'PCM' if codec == 1 else 'float'} {bits}-bit"
    return ChannelAudio(pcm, rate, source_format, loop_start, loop_end)


def decode_channel_audio(data):
    if len(data) > MAX_RESOURCE_BYTES:
        raise ValueError("Channel sound resource exceeds the 128 MiB limit")
    if data[:4] == b"BNS ":
        return decode_bns(data)
    if data[:4] == b"RIFF":
        return decode_wave(data)
    raise ValueError("Unsupported channel sound format; expected BNS or uncompressed RIFF/WAVE")
