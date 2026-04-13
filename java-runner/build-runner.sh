#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNNER_DIR="$ROOT_DIR/java-runner"
TOOLS_DIR="$RUNNER_DIR/.tools"
BUILD_DIR="$RUNNER_DIR/build"
LIB_DIR="$BUILD_DIR/lib"
CLASSES_DIR="$BUILD_DIR/classes"
CS_BIN="$TOOLS_DIR/cs"

mkdir -p "$TOOLS_DIR"

if [[ ! -x "$CS_BIN" ]]; then
	curl -fsSL -o "$CS_BIN" https://git.io/coursier-cli-linux
	chmod +x "$CS_BIN"
fi

DEPENDENCIES=(
	org.eclipse.jdt:org.eclipse.jdt.core:3.45.0
	org.eclipse.platform:org.eclipse.text:3.14.600
)

CLASSPATH="$($CS_BIN fetch --classpath "${DEPENDENCIES[@]}")"

rm -rf "$BUILD_DIR"
mkdir -p "$LIB_DIR" "$CLASSES_DIR"

IFS=':' read -r -a CP_ENTRIES <<< "$CLASSPATH"
for entry in "${CP_ENTRIES[@]}"; do
	cp "$entry" "$LIB_DIR/"
done

LIB_CLASSPATH="$(find "$LIB_DIR" -maxdepth 1 -name '*.jar' -print | sort | paste -sd ':' -)"

find "$RUNNER_DIR/src/main/java" -name '*.java' -print0 \
	| xargs -0 javac -cp "$LIB_CLASSPATH" -d "$CLASSES_DIR"

jar --create --file "$BUILD_DIR/eclipse-formatter-runner.jar" -C "$CLASSES_DIR" .

printf 'Built Java formatter runner at %s\n' "$BUILD_DIR/eclipse-formatter-runner.jar"