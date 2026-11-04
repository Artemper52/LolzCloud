!include WinVer.nsh
!macro customInit
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "Этот установщик предназначен для Windows 10 и 11. Для Windows 7 SP1 скачайте отдельный LolzCloud Legacy на lolzcloud.com."
    Quit
  ${EndIf}
!macroend
