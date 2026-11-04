$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$lolzAssets = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\source\app\lib\assets'))
$lolzBitmap = New-Object System.Drawing.Bitmap 256,256
$lolzGraphics = [System.Drawing.Graphics]::FromImage($lolzBitmap)
$lolzGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$lolzBackground = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#15291e'))
$lolzCloudBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#8ee4ad'))
$lolzRound = New-Object System.Drawing.Drawing2D.GraphicsPath
foreach ($lolzArc in @(@(8,8,108,108,180,90),@(140,8,108,108,270,90),@(140,140,108,108,0,90),@(8,140,108,108,90,90))) { $lolzRound.AddArc([single]$lolzArc[0],[single]$lolzArc[1],[single]$lolzArc[2],[single]$lolzArc[3],[single]$lolzArc[4],[single]$lolzArc[5]) }
$lolzRound.CloseFigure()
$lolzGraphics.FillPath($lolzBackground,$lolzRound)
$lolzCloud = New-Object System.Drawing.Drawing2D.GraphicsPath
$lolzCloud.AddBezier(72,170,32,170,30,110,70,108)
$lolzCloud.AddBezier(70,108,70,60,128,45,152,84)
$lolzCloud.AddBezier(152,84,182,72,211,96,202,126)
$lolzCloud.AddBezier(202,126,234,135,229,170,197,170)
$lolzCloud.CloseFigure()
$lolzGraphics.FillPath($lolzCloudBrush,$lolzCloud)
$lolzPen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml('#15291e')),10
$lolzPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$lolzPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
foreach ($lolzBar in @(@(91,130),@(116,111),@(141,99),@(166,119))) { $lolzGraphics.DrawLine($lolzPen,[single]$lolzBar[0],[single]$lolzBar[1],[single]$lolzBar[0],150) }
$lolzBitmap.Save((Join-Path $lolzAssets 'logo.png'),[System.Drawing.Imaging.ImageFormat]::Png)
$lolzImages = @()
foreach ($lolzSize in @(16,24,32,48,64,128,256)) {
  $lolzScaled = New-Object System.Drawing.Bitmap $lolzSize,$lolzSize
  $lolzScaleGraphics = [System.Drawing.Graphics]::FromImage($lolzScaled)
  $lolzScaleGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $lolzScaleGraphics.DrawImage($lolzBitmap,0,0,$lolzSize,$lolzSize)
  $lolzStream = New-Object System.IO.MemoryStream
  $lolzScaled.Save($lolzStream,[System.Drawing.Imaging.ImageFormat]::Png)
  $lolzImages += ,@{size=$lolzSize;data=$lolzStream.ToArray()}
  $lolzStream.Dispose(); $lolzScaleGraphics.Dispose(); $lolzScaled.Dispose()
}
$lolzFile = [System.IO.File]::Create((Join-Path $lolzAssets 'icon.ico'))
$lolzWriter = New-Object System.IO.BinaryWriter $lolzFile
$lolzWriter.Write([uint16]0); $lolzWriter.Write([uint16]1); $lolzWriter.Write([uint16]$lolzImages.Count)
$lolzOffset = 6 + 16 * $lolzImages.Count
foreach ($lolzImage in $lolzImages) {
  $lolzDimension = if ($lolzImage.size -eq 256) { 0 } else { $lolzImage.size }
  $lolzWriter.Write([byte]$lolzDimension); $lolzWriter.Write([byte]$lolzDimension)
  $lolzWriter.Write([byte]0); $lolzWriter.Write([byte]0)
  $lolzWriter.Write([uint16]1); $lolzWriter.Write([uint16]32)
  $lolzWriter.Write([uint32]$lolzImage.data.Length); $lolzWriter.Write([uint32]$lolzOffset)
  $lolzOffset += $lolzImage.data.Length
}
foreach ($lolzImage in $lolzImages) { $lolzWriter.Write([byte[]]$lolzImage.data) }
$lolzWriter.Dispose(); $lolzFile.Dispose(); $lolzPen.Dispose(); $lolzRound.Dispose(); $lolzCloud.Dispose(); $lolzCloudBrush.Dispose(); $lolzBackground.Dispose(); $lolzGraphics.Dispose(); $lolzBitmap.Dispose()
Write-Output 'Generated LolzCloud icon and PNG from the editable logo design.'
