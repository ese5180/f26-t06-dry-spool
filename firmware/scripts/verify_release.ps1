param(
    [string]$BuildDir = ".\build-dryspool"
)

$ErrorActionPreference = "Stop"

$elfPath = Join-Path $BuildDir "firmware\zephyr\zephyr.elf"
$imagePath = Join-Path $BuildDir "firmware\zephyr\zephyr.signed.bin"
$signingKeyPath = Join-Path $PSScriptRoot "..\keys\dryspool-signing.pem"

foreach ($path in @($elfPath, $imagePath, $signingKeyPath)) {
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Required release file not found: $path"
    }
}

if (-not $env:ZEPHYR_BASE) {
    throw "ZEPHYR_BASE is not set. Run this script from an nRF Connect SDK terminal."
}

$nm = Get-Command arm-zephyr-eabi-nm -ErrorAction Stop
$readelf = Get-Command arm-zephyr-eabi-readelf -ErrorAction Stop
$python = Get-Command python -ErrorAction Stop
$imgtoolPath = Join-Path $env:ZEPHYR_BASE "..\bootloader\mcuboot\scripts\imgtool.py"

if (-not (Test-Path -LiteralPath $imgtoolPath)) {
    throw "MCUboot imgtool not found: $imgtoolPath"
}

$memfaultSymbol = & $nm.Source $elfPath | Select-String "g_memfault_build_id"
if ($LASTEXITCODE -ne 0 -or -not $memfaultSymbol) {
    throw "Memfault Build-ID descriptor is missing from the release ELF."
}

$buildIdNote = & $readelf.Source -n $elfPath | Select-String "Build ID:"
if ($LASTEXITCODE -ne 0 -or -not $buildIdNote) {
    throw "GNU Build ID is missing from the release ELF."
}

& $python.Source $imgtoolPath verify -k $signingKeyPath $imagePath
if ($LASTEXITCODE -ne 0) {
    throw "MCUboot signature verification failed."
}

Write-Host "Memfault symbol: $($memfaultSymbol.Line.Trim())"
Write-Host "ELF $($buildIdNote.Line.Trim())"
Write-Host "Release preflight passed. Upload this exact ELF and signed binary together."
