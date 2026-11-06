!include WinVer.nsh
!include "${__FILEDIR__}\installer-checks.nsh"
!macro customInit
  ${IfNot} ${AtLeastWin7}
    MessageBox MB_OK|MB_ICONSTOP "LolzCloud Legacy требует Windows 7 SP1 или новее."
    Quit
  ${EndIf}
  !insertmacro lcCheckSpace "$INSTDIR"
  !insertmacro lcCheckSpace "$TEMP"
!macroend
