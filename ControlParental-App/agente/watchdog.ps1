$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$exe = Join-Path $dir 'tool.exe'
while ($true) {
    $proc = Get-CimInstance Win32_Process -Filter "Name='tool.exe'" -ErrorAction SilentlyContinue
    if (-not $proc) {
        Start-Process -FilePath $exe -WorkingDirectory $dir -WindowStyle Hidden
    }
    Start-Sleep -Seconds 30
}
