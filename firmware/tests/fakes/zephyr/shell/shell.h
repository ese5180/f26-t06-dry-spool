#pragma once
#include <stdbool.h>
#include <stddef.h>
struct shell { int unused; };
#define shell_error(sh, ...) ((void)(sh))
#define shell_print(sh, ...) ((void)(sh))
#define SHELL_CMD_ARG_REGISTER(...)
