param(
  [switch]$Sign,
  [string]$PublishDir
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$workspace = Split-Path $repo -Parent
$dotnet = Join-Path $workspace '.tools\dotnet\dotnet.exe'
$nuget = Join-Path $PSScriptRoot 'NuGet.config'
$tools = Join-Path $workspace '.tools\nuget-packages\microsoft.windows.sdk.buildtools\10.0.28000.2705\bin\10.0.28000.0\x64'
$makeappx = Join-Path $tools 'makeappx.exe'
$signtool = Join-Path $tools 'signtool.exe'
foreach ($path in @($dotnet, $makeappx)) { if (-not (Test-Path -LiteralPath $path)) { throw "缺少构建工具: $path" } }
$out = Join-Path $repo 'artifacts\windows'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmssfff'
$build = Join-Path $out ('build-' + $stamp)
$stage = Join-Path $build 'stage'
$publish = Join-Path $build 'publish'
$package = Join-Path $out ('UniFlow-1.7.0-' + $stamp + '-x64.msix')
New-Item -ItemType Directory -Force -Path $stage, $publish, (Join-Path $stage 'Assets'), (Join-Path $stage 'web') | Out-Null
$env:DOTNET_CLI_HOME = Join-Path $workspace '.tools\dotnet-home'
$env:NUGET_PACKAGES = Join-Path $workspace '.tools\nuget-packages'
$env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = '1'

if ($PublishDir) {
  $source = (Resolve-Path $PublishDir).Path
  if (-not (Test-Path (Join-Path $source 'UniFlow.Windows.exe'))) { throw "PublishDir 中没有 UniFlow.Windows.exe: $source" }
  Copy-Item (Join-Path $source '*') $publish -Recurse -Force
} else {
  & $dotnet publish (Join-Path $PSScriptRoot 'UniFlow.Windows\UniFlow.Windows.csproj') -c Release -r win-x64 --self-contained true --configfile $nuget -o $publish
  if ($LASTEXITCODE) { throw 'dotnet publish failed' }
}
if (-not (Test-Path (Join-Path $publish 'UniFlow.Windows.exe'))) { throw '发布输出缺少 UniFlow.Windows.exe' }
if (-not (Test-Path (Join-Path $publish 'coreclr.dll'))) { throw '发布输出缺少 .NET 运行时文件，拒绝打包不完整应用' }
Copy-Item (Join-Path $publish '*') $stage -Recurse -Force
Get-ChildItem $stage -Recurse -File | Where-Object { $_.Name -match '\.pdb$|\.xml$|Microsoft\.Web\.WebView2\.Wpf\.dll$|^.*\.Wpf\.dll$' } | Remove-Item -Force
$web = Join-Path $stage 'web'
foreach ($name in @('index.html','app.js','icons.js','styles.css','native.css','onboarding.css','weather.css','system-integrations.css','ai.css')) { Copy-Item (Join-Path $repo $name) $web }
Copy-Item (Join-Path $repo 'assets') $web -Recurse -Force
Copy-Item (Join-Path $repo 'js') $web -Recurse -Force
Copy-Item (Join-Path $PSScriptRoot 'Package.appxmanifest') (Join-Path $stage 'AppxManifest.xml')

Add-Type -AssemblyName System.Drawing
function New-Logo([string]$path, [int]$size) {
  $bmp = [System.Drawing.Bitmap]::new($size, $size); $g = [System.Drawing.Graphics]::FromImage($bmp)
  try { $g.Clear([System.Drawing.Color]::FromArgb(37,99,235)); $font = [System.Drawing.Font]::new('Segoe UI', [single][Math]::Max(10, [int]($size*.42)), [System.Drawing.FontStyle]::Bold); try { $g.DrawString('U',$font,[System.Drawing.Brushes]::White,([single]($size*.2)),([single]($size*.2))) } finally { $font.Dispose() }; $bmp.Save($path,[System.Drawing.Imaging.ImageFormat]::Png) } finally { $g.Dispose(); $bmp.Dispose() }
}
New-Logo (Join-Path $stage 'Assets\StoreLogo.png') 50
New-Logo (Join-Path $stage 'Assets\Square150x150Logo.png') 150
New-Logo (Join-Path $stage 'Assets\Square44x44Logo.png') 44
$packOutput = & $makeappx pack /d $stage /p $package /o 2>&1
if ($LASTEXITCODE) { throw "makeappx failed: $($packOutput | Out-String)" }
Write-Host 'MSIX package creation succeeded.'
$inspection = Join-Path $build 'inspection'
$unpackOutput = & $makeappx unpack /p $package /d $inspection 2>&1
if ($LASTEXITCODE) { throw "MSIX unpack verification failed: $($unpackOutput | Out-String)" }
foreach ($required in @('UniFlow.Windows.exe','coreclr.dll','web\index.html','web\js\notification-capture-ui.js','AppxManifest.xml')) {
  if (-not (Test-Path -LiteralPath (Join-Path $inspection $required))) { throw "MSIX 缺少必需文件: $required" }
}
if (Test-Path -LiteralPath (Join-Path $inspection 'Microsoft.Web.WebView2.Wpf.dll')) { throw 'MSIX 意外包含未使用的 WPF 组件。' }

$cer = Join-Path $build 'UniFlow-dev.cer'
$cert = $null
try {
  if ($Sign) {
    if (-not (Test-Path -LiteralPath $signtool)) { throw "缺少签名工具: $signtool" }
    $cert = New-SelfSignedCertificate -Type Custom -Subject 'CN=UniFlow' -FriendlyName 'UniFlow temporary MSIX build certificate' -CertStoreLocation 'Cert:\CurrentUser\My' -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -KeyUsage DigitalSignature -KeyExportPolicy NonExportable -NotAfter (Get-Date).AddYears(2) -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3','2.5.29.19={text}')
    Export-Certificate -Cert $cert -FilePath $cer -Force | Out-Null
    & $signtool sign /fd SHA256 /sha1 $cert.Thumbprint /s My $package
    if ($LASTEXITCODE) { throw 'signtool sign failed' }
    $verify = (& $signtool verify /pa /all /v $package 2>&1 | Out-String)
    $verifyExit = $LASTEXITCODE
    $signature = Get-AuthenticodeSignature -LiteralPath $package
    if (-not $signature.SignerCertificate) { throw "包签名验证失败: $verify" }
    if ($verifyExit -ne 0 -and $verify -notmatch '(?i)root certificate.*not trusted|0x800B0109|chain processed.*terminated') { throw "包签名验证失败: $verify" }
    $hash = (Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash
    Write-Host "MSIX: $package"
    Write-Host "SHA256: $hash"
    Write-Host "Certificate: $cer"
    Write-Host '开发证书是自签名证书；安装前请由用户手动信任 .cer。私钥不会随安装包交付。'
  } else {
    Write-Host "Unsigned MSIX: $package"
    Write-Host '未签名包只用于结构检查，Windows 不会把它当作可安装的生产包。请在可用的代码签名环境中使用 -Sign，或交给发布流水线签名。'
  }
} finally {
  if ($cert) { Remove-Item -LiteralPath (Join-Path 'Cert:\CurrentUser\My' $cert.Thumbprint) -Force -ErrorAction SilentlyContinue }
}
