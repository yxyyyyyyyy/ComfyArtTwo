#!/bin/sh
set -eu
exec ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -L 127.0.0.1:8188:127.0.0.1:8188 5090
