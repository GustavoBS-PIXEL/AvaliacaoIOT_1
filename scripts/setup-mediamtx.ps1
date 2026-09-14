param(
    [string]$Version = 'v1.21.0',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$destination = Join-Path $projectRoot 'vendor\mediamtx'
$executable = Join-Path $destination 'mediamtx.exe'
$versionFile = Join-Path $destination 'VERSION'
$archive = Join-Path ([System.IO.Path]::GetTempPath()) "mediamtx-$Version.zip"
$downloadUrl = "https://github.com/bluenviron/mediamtx/releases/download/$Version/mediamtx_${Version}_windows_amd64.zip"

if ((Test-Path -LiteralPath $executable) -and -not $Force) {
    $installedVersion = if (Test-Path -LiteralPath $versionFile) {
        (Get-Content -LiteralPath $versionFile -Raw).Trim()
    } else {
        $Version
    }

    Write-Host "MediaMTX já está instalado ($installedVersion)."
    Write-Host 'Nenhum arquivo foi substituído. Execute npm start para iniciar o painel.'
    exit 0
}

if ($Force -and (Test-Path -LiteralPath $executable)) {
    try {
        $lockTest = [System.IO.File]::Open(
            $executable,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::ReadWrite,
            [System.IO.FileShare]::None
        )
        $lockTest.Dispose()
    } catch {
        throw 'O MediaMTX está em execução. Encerre o npm start (Ctrl+C) antes de forçar a reinstalação.'
    }
}

New-Item -ItemType Directory -Force -Path $destination | Out-Null
Write-Host "Baixando MediaMTX $Version..."
Invoke-WebRequest -UseBasicParsing -Uri $downloadUrl -OutFile $archive
Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force
Remove-Item -LiteralPath $archive -Force
Set-Content -LiteralPath $versionFile -Value $Version -Encoding ASCII
Write-Host "MediaMTX instalado em $destination"
Write-Host 'Execute npm start para iniciar o painel e o servidor de vídeo.'
