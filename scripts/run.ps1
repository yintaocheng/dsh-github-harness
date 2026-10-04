# Credentials stay in process memory and Windows Credential Manager, never in arguments or files.
# Run from the target checkout. Arguments are forwarded to the Node CLI.
$ErrorActionPreference = 'Stop'
$oldToken = $env:GH_TOKEN
$oldPrompt = $env:GIT_TERMINAL_PROMPT
$oldInteractive = $env:GCM_INTERACTIVE
try {
    if (-not $env:GH_TOKEN -and -not $env:GITHUB_TOKEN) {
        $env:GIT_TERMINAL_PROMPT = '0'
        $env:GCM_INTERACTIVE = 'never'
        $raw = "protocol=https`nhost=github.com`n`n" | & git credential fill 2>$null
        if ($LASTEXITCODE -ne 0) { throw 'No GitHub credential. Run: git credential-manager github login --username yintaocheng --browser' }
        foreach ($line in $raw) {
            if ($line.StartsWith('password=')) { $env:GH_TOKEN = $line.Substring(9) }
        }
        $raw = $null
        if (-not $env:GH_TOKEN) { throw 'Credential Manager returned no GitHub token' }
    }
    & node (Join-Path $PSScriptRoot '..\src\cli.mjs') @args
    $result = $LASTEXITCODE
} finally {
    $env:GH_TOKEN = $oldToken
    $env:GIT_TERMINAL_PROMPT = $oldPrompt
    $env:GCM_INTERACTIVE = $oldInteractive
}
exit $result
