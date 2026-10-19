# Server statico locale per provare l'app: http://localhost:8080
param([int]$Port = $(if ($env:PORT) { [int]$env:PORT } else { 8097 }))

$root = $PSScriptRoot
$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.js' = 'text/javascript; charset=utf-8'; '.json' = 'application/json'
  '.webmanifest' = 'application/manifest+json'; '.png' = 'image/png'; '.svg' = 'image/svg+xml'; '.jpg' = 'image/jpeg'; '.txt' = 'text/plain; charset=utf-8'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "GACash su http://localhost:$Port (Ctrl+C per fermare)"

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if (-not $rel) { $rel = 'index.html' }
    $path = [IO.Path]::GetFullPath((Join-Path $root $rel))
    try {
      if ($path.StartsWith($root + [IO.Path]::DirectorySeparatorChar) -and (Test-Path $path -PathType Leaf)) {
        $bytes = [IO.File]::ReadAllBytes($path)
        $type = $mime[[IO.Path]::GetExtension($path).ToLower()]
        if (-not $type) { $type = 'application/octet-stream' }
        $ctx.Response.ContentType = $type
        $ctx.Response.Headers.Add('Cache-Control', 'no-cache')
        $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      } else {
        $ctx.Response.StatusCode = 404
      }
    } catch {
      $ctx.Response.StatusCode = 500
    } finally {
      $ctx.Response.Close()
    }
  }
} finally {
  $listener.Stop()
}
