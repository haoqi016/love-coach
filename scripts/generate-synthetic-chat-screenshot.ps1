param(
  [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $OutputPath = Join-Path $repoRoot "tmp\evals\synthetic-chat.png"
} elseif (-not [System.IO.Path]::IsPathRooted($OutputPath)) {
  $OutputPath = Join-Path $repoRoot $OutputPath
}
$OutputPath = [System.IO.Path]::GetFullPath($OutputPath)
if ([System.IO.Path]::GetExtension($OutputPath).ToLowerInvariant() -ne ".png") {
  throw "OutputPath must end in .png"
}

$outputDirectory = Split-Path -Parent $OutputPath
[System.IO.Directory]::CreateDirectory($outputDirectory) | Out-Null

Add-Type -AssemblyName System.Drawing
$bitmap = [System.Drawing.Bitmap]::new(1200, 980)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$background = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(244, 244, 244))
$panel = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
$selfBubble = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(220, 246, 211))
$otherBubble = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(235, 235, 235))
$headingBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(90, 90, 90))
$textBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(25, 25, 25))
$headingFont = [System.Drawing.Font]::new("Microsoft YaHei", 24, [System.Drawing.FontStyle]::Bold)
$chatFont = [System.Drawing.Font]::new("Microsoft YaHei", 30, [System.Drawing.FontStyle]::Regular)
$format = [System.Drawing.StringFormat]::new()
$format.Trimming = [System.Drawing.StringTrimming]::Word

try {
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
  $graphics.FillRectangle($background, 0, 0, 1200, 980)
  $graphics.FillRectangle($panel, 50, 40, 1100, 900)
  $graphics.DrawString(
    "纯合成评测对话 · 不含真实姓名、头像或账号",
    $headingFont,
    $headingBrush,
    [System.Drawing.RectangleF]::new(95, 78, 1010, 55),
    $format
  )

  $messages = @(
    @{ Self = $true; Text = "你周末一般会做什么？最近有没有发现好喝的咖啡？" },
    @{ Self = $false; Text = "我喜欢周末去找小咖啡店，上次喝到一杯桂花拿铁。" },
    @{ Self = $true; Text = "听起来不错，我也喜欢咖啡，不过还没试过桂花味。" },
    @{ Self = $false; Text = "下次看到合适的店，我可以把名字发给你。" }
  )
  $y = 155
  foreach ($message in $messages) {
    $x = if ($message.Self) { 320 } else { 95 }
    $bubbleBrush = if ($message.Self) { $selfBubble } else { $otherBubble }
    $graphics.FillRectangle($bubbleBrush, $x, $y, 785, 165)
    $graphics.DrawString(
      $message.Text,
      $chatFont,
      $textBrush,
      [System.Drawing.RectangleF]::new($x + 24, $y + 22, 735, 125),
      $format
    )
    $y += 185
  }

  $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  $format.Dispose()
  $chatFont.Dispose()
  $headingFont.Dispose()
  $textBrush.Dispose()
  $headingBrush.Dispose()
  $otherBubble.Dispose()
  $selfBubble.Dispose()
  $panel.Dispose()
  $background.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}

Write-Output $OutputPath
