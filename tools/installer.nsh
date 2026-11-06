!include WinVer.nsh
!include "${__FILEDIR__}\installer-checks.nsh"
!macro customInit
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "Этот установщик предназначен для Windows 10 и 11. Для Windows 7 SP1 скачайте отдельный LolzCloud Legacy на lolzcloud.com."
    Quit
  ${EndIf}
  !insertmacro lcCheckSpace "$INSTDIR"
  !insertmacro lcCheckSpace "$TEMP"
!macroend
