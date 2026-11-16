#include <stdio.h>
#include <string.h>
#include <strings.h>
#include <zephyr/data/json.h>
#include <zephyr/kernel.h>
#include <zephyr/net/http/server.h>
#include <zephyr/net/http/service.h>
#include <zephyr/net/net_if.h>
#include <zephyr/net/wifi_mgmt.h>
#include <coex.h>
#include <zephyr/net/socket.h>
#include <zephyr/random/random.h>
#include "bridge.h"

static const uint8_t page[] = {
#include <dryspool_page.inc>
};
static struct http_resource_detail_static home = {
	.common = {.type = HTTP_RESOURCE_TYPE_STATIC,
		   .bitmask_of_supported_http_methods = BIT(HTTP_GET),
		   .content_type = "text/html; charset=utf-8",
		   .content_encoding = "gzip"},
	.static_data = page,
	.static_data_len = sizeof(page),
};
static uint16_t port = 8080;
HTTP_SERVICE_DEFINE(gateway_http, NULL, &port, CONFIG_HTTP_SERVER_MAX_CLIENTS, 4, NULL, NULL, NULL);
HTTP_RESOURCE_DEFINE(home_page, gateway_http, "/", &home);
HTTP_SERVER_REGISTER_HEADER_CAPTURE(gw_cookie, "Cookie");
HTTP_SERVER_REGISTER_HEADER_CAPTURE(gw_type, "Content-Type");

enum action {
	LIST,
	PAIR,
	FAN_A,
	FAN_B
};
struct exchange {
	enum action action;
	char input[100];
	size_t used;
	bool allowed;
	bool json;
	bool overflow;
	char output[850];
};
static char code[13], token[36], cookie_header[96];
static struct http_header set_cookie = {.name = "Set-Cookie", .value = cookie_header};
static const struct http_header no_cache = {.name = "Cache-Control", .value = "no-store"};

struct args {
	char *mode;
	char *code;
};
static const struct json_obj_descr fields[] = {
	JSON_OBJ_DESCR_PRIM(struct args, mode, JSON_TOK_STRING),
	JSON_OBJ_DESCR_PRIM(struct args, code, JSON_TOK_STRING),
};

static bool has_session(const char *cookies)
{
	size_t expected = strlen(token);
	while (*cookies) {
		while (*cookies == ' ') {
			cookies++;
		}
		size_t length = strcspn(cookies, ";");
		if (length == expected && !memcmp(cookies, token, length)) {
			return true;
		}
		cookies += length;
		if (*cookies) {
			cookies++;
		}
	}
	return false;
}

static int dispatch(struct exchange *x, struct http_response_ctx *res)
{
	struct args input = {0};
	res->headers = &no_cache;
	res->header_count = 1;
	strcpy(x->output, "{}");
	if (x->action != PAIR && !x->allowed) {
		return HTTP_401_UNAUTHORIZED;
	}
	if (x->action == LIST) {
		x->output[0] = '[';
		int a = gateway_snapshot(0, x->output + 1, sizeof(x->output) - 2);
		if (a < 0 || a >= sizeof(x->output) - 3) {
			return HTTP_500_INTERNAL_SERVER_ERROR;
		}
		x->output[1 + a] = ',';
		int b = gateway_snapshot(1, x->output + 2 + a, sizeof(x->output) - 3 - a);
		if (b < 0 || b >= sizeof(x->output) - 3 - a) {
			return HTTP_500_INTERNAL_SERVER_ERROR;
		}
		strcpy(x->output + 2 + a + b, "]");
		return HTTP_200_OK;
	}
	if (!x->json || x->overflow ||
	    json_obj_parse(x->input, x->used, fields, ARRAY_SIZE(fields), &input) < 0) {
		return HTTP_400_BAD_REQUEST;
	}
	if (x->action == PAIR) {
		if (!input.code || strcmp(input.code, code)) {
			strcpy(x->output, "{\"error\":\"Incorrect pairing code\"}");
			return HTTP_403_FORBIDDEN;
		}
		res->headers = &set_cookie;
		return HTTP_200_OK;
	}
	uint32_t id;
	if (!input.mode) {
		return HTTP_400_BAD_REQUEST;
	}
	int rc = gateway_command(x->action == FAN_B, input.mode, &id);
	if (rc) {
		strcpy(x->output, "{\"error\":\"Check the box connection and the previous command.\"}");
		return rc == -EINVAL ? HTTP_400_BAD_REQUEST : HTTP_409_CONFLICT;
	}
	snprintf(x->output, sizeof(x->output), "{\"request\":%u}", id);
	return HTTP_202_ACCEPTED;
}

static int api(struct http_client_ctx *client, enum http_transaction_status status,
	       const struct http_request_ctx *req, struct http_response_ctx *res, void *user)
{
	struct exchange *x = user;
	if (status == HTTP_SERVER_TRANSACTION_COMPLETE ||
	    status == HTTP_SERVER_TRANSACTION_ABORTED) {
		x->used = 0;
		x->allowed = x->json = x->overflow = false;
		return 0;
	}
	for (size_t i = 0; i < req->header_count; i++) {
		const struct http_header *h = &req->headers[i];
		if (!strcasecmp(h->name, "Cookie")) {
			x->allowed = has_session(h->value);
		}
		if (!strcasecmp(h->name, "Content-Type")) {
			x->json = !strcasecmp(h->value, "application/json");
		}
	}
	if (req->data_len >= sizeof(x->input) - x->used) {
		x->overflow = true;
	}
	if (!x->overflow && req->data_len) {
		memcpy(x->input + x->used, req->data, req->data_len);
		x->used += req->data_len;
	}
	if (status == HTTP_SERVER_REQUEST_DATA_FINAL) {
		x->input[x->used] = 0;
		res->status = dispatch(x, res);
		res->body = (const uint8_t *)x->output;
		res->body_len = strlen(x->output);
		res->final_chunk = true;
	}
	return 0;
}

#define ENDPOINT(name, path, verb, operation)                                                      \
	static struct exchange name##_data = {.action = operation};                                \
	static struct http_resource_detail_dynamic name##_handler = {                              \
		.common = {.type = HTTP_RESOURCE_TYPE_DYNAMIC,                                     \
			   .bitmask_of_supported_http_methods = BIT(verb),                         \
			   .content_type = "application/json"},                                    \
		.cb = api,                                                                         \
		.user_data = &name##_data};                                                        \
	HTTP_RESOURCE_DEFINE(name, gateway_http, path, &name##_handler)
ENDPOINT(devices, "/api/devices", HTTP_GET, LIST);
ENDPOINT(pair, "/api/pair", HTTP_POST, PAIR);
ENDPOINT(fan_a, "/api/A/fan", HTTP_POST, FAN_A);
ENDPOINT(fan_b, "/api/B/fan", HTTP_POST, FAN_B);

static void print_address(struct k_work *work);
static K_WORK_DELAYABLE_DEFINE(address_work, print_address);
static void print_address(struct k_work *work)
{
	struct net_if *iface = net_if_get_default();
	struct net_in_addr *addr = net_if_ipv4_get_global_addr(iface, NET_ADDR_PREFERRED);
	static char last[NET_IPV4_ADDR_LEN];
	static int last_band = -1;
	if (!addr) {
		last_band = -1;
		last[0] = 0;
	}
	struct wifi_iface_status sta = {0};
	if (addr && net_mgmt(NET_REQUEST_WIFI_IFACE_STATUS, iface, &sta, sizeof(sta)) == 0 &&
	    (sta.band == WIFI_FREQ_BAND_2_4_GHZ || sta.band == WIFI_FREQ_BAND_5_GHZ) &&
	    last_band != sta.band) {
		enum nrf_wifi_pta_wlan_op_band band = sta.band == WIFI_FREQ_BAND_5_GHZ
							      ? NRF_WIFI_PTA_WLAN_OP_BAND_5_GHZ
							      : NRF_WIFI_PTA_WLAN_OP_BAND_2_4_GHZ;
		if (!nrf_wifi_coex_config_non_pta(true, true) &&
		    !nrf_wifi_coex_config_pta(band, true, true)) {
			last_band = sta.band;
		}
	}
	char ip[NET_IPV4_ADDR_LEN];
	if (addr && net_addr_ntop(NET_AF_INET, addr, ip, sizeof(ip)) && strcmp(last, ip)) {
		strcpy(last, ip);
		printk("DrySpool dashboard http://%s:%u   login code %s\n", ip, port, code);
	}
	k_work_reschedule(&address_work, K_SECONDS(5));
}

int gateway_http_start(void)
{
	const struct net_linkaddr *mac = net_if_get_link_addr(net_if_get_default());
	if (mac && mac->len == 6) {
		printk("Register gateway Wi-Fi MAC %02x:%02x:%02x:%02x:%02x:%02x\n", mac->addr[0],
		       mac->addr[1], mac->addr[2], mac->addr[3], mac->addr[4], mac->addr[5]);
	}
	int switch_rc = nrf_wifi_config_sr_switch(true);
	if (switch_rc) {
		return switch_rc;
	}
	uint32_t words[6];
	if (sys_csrand_get(words, sizeof(words))) {
		return -EIO;
	}
	snprintf(code, sizeof(code), "%08x%04x", words[0], words[1] & 0xffff);
	snprintf(token, sizeof(token), "ds=%08x%08x%08x%08x", words[2], words[3], words[4],
		 words[5]);
	snprintf(cookie_header, sizeof(cookie_header), "%s; Path=/; HttpOnly; SameSite=Strict",
		 token);
	int rc = http_server_start();
	if (!rc) {
		k_work_schedule(&address_work, K_NO_WAIT);
	}
	return rc;
}
