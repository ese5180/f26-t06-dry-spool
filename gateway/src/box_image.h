#pragma once

#include <stdbool.h>
#include <stdint.h>
#include <stddef.h>
#include <string.h>

/* MCUboot signed protected TLV 0x00a0 identifies the hardware role. Validate
 * it before selecting slot 1 for a trial, even for a mislabelled cloud release.
 * A bounded protected area is sufficient for the two team-signed payloads. */
struct box_image_identity {
	size_t start;
	size_t length;
	size_t copied;
	uint8_t tlvs[256];
};

static inline uint16_t image_le16(const uint8_t *p)
{
	return (uint16_t)p[0] | ((uint16_t)p[1] << 8);
}

static inline uint32_t image_le32(const uint8_t *p)
{
	return (uint32_t)image_le16(p) | ((uint32_t)image_le16(p + 2) << 16);
}

static inline bool box_image_observe(struct box_image_identity *id, const uint8_t *data,
				     size_t size, size_t offset, size_t total)
{
	if (!offset) {
		if (size < 32 || image_le32(data) != 0x96f3b83dU) {
			return false;
		}
		size_t hdr = image_le16(data + 8);
		size_t body = image_le32(data + 12);
		size_t prot = image_le16(data + 10);
		if (hdr < 32 || hdr > total || body > total - hdr || prot < 4 ||
		    prot > sizeof(id->tlvs) || prot > total - hdr - body) {
			return false;
		}
		*id = (struct box_image_identity){.start = hdr + body, .length = prot};
	}
	size_t start = id->start + id->copied;
	if (start >= offset && start - offset < size && id->copied < id->length) {
		size_t n = size - (start - offset);
		if (n > id->length - id->copied) {
			n = id->length - id->copied;
		}
		memcpy(id->tlvs + id->copied, data + (start - offset), n);
		id->copied += n;
	}
	return true;
}

static inline bool box_image_matches(const struct box_image_identity *id, const char *role)
{
	if (!id->length || id->copied != id->length || image_le16(id->tlvs) != 0x6908 ||
	    image_le16(id->tlvs + 2) != id->length) {
		return false;
	}
	size_t offset = 4;
	bool found = false;
	while (id->length - offset >= 4) {
		uint16_t type = image_le16(id->tlvs + offset);
		size_t size = image_le16(id->tlvs + offset + 2);
		offset += 4;
		if (size > id->length - offset) {
			return false;
		}
		if (type == 0x00a0) {
			if (found || size != strlen(role) ||
			    memcmp(id->tlvs + offset, role, size)) {
				return false;
			}
			found = true;
		}
		offset += size;
	}
	return found && offset == id->length;
}
