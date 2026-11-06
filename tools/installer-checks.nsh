!include FileFunc.nsh

!macro lcCheckSpace LOCATION
  Push $0
  Push $1
  Push $2
  Push $3
  StrCpy $0 "${LOCATION}"
  ${Do}
    System::Call 'kernel32::GetDiskFreeSpaceExW(w r0, *l .r1, p 0, p 0) i .r2'
    ${If} $2 == 0
      ${GetParent} "$0" $3
      ${If} $3 == ""
      ${OrIf} $3 == $0
        MessageBox MB_OK|MB_ICONSTOP "Не удалось проверить свободное место в $0. Проверьте доступ к папке и повторите установку." /SD IDOK
        SetErrorLevel 5
        Quit
      ${EndIf}
      StrCpy $0 $3
    ${EndIf}
  ${LoopUntil} $2 != 0
  System::Int64Op $1 / 1024
  Pop $1
  System::Int64Op $1 < ${LOLZCLOUD_REQUIRED_KB}
  Pop $2
  ${If} $2 != 0
    MessageBox MB_OK|MB_ICONSTOP "Недостаточно свободного места в $0.$\r$\n$\r$\nДля установки и временной распаковки нужно не менее ${LOLZCLOUD_REQUIRED_MB} МБ. Освободите место и запустите Setup ещё раз." /SD IDOK
    SetErrorLevel 112
    Quit
  ${EndIf}
  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend

!macro lcCheckInstalledFile RELATIVE_PATH EXPECTED_SIZE
  Push $0
  Push $1
  ClearErrors
  FileOpen $0 "$INSTDIR\${RELATIVE_PATH}" r
  FileSeek $0 0 END $1
  FileClose $0
  ${If} ${Errors}
  ${OrIf} $1 != ${EXPECTED_SIZE}
    MessageBox MB_OK|MB_ICONSTOP "Не удалось полностью установить LolzCloud.$\r$\n$\r$\nПроверьте свободное место и доступ к папке установки, затем запустите Setup ещё раз." /SD IDOK
    SetErrorLevel 13
    Quit
  ${EndIf}
  Pop $1
  Pop $0
!macroend

!macro customInstall
  !insertmacro lcCheckInstalledFile "LolzCloud.exe" ${LOLZCLOUD_EXE_BYTES}
  !insertmacro lcCheckInstalledFile "resources\app.asar" ${LOLZCLOUD_ASAR_BYTES}
  !insertmacro lcCheckInstalledFile "resources\app.asar.unpacked\node_modules\ffmpeg-static\ffmpeg.exe" ${LOLZCLOUD_FFMPEG_BYTES}
!macroend
