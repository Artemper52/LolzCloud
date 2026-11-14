@echo off
setlocal
set "APP_DIR=%~dp0"
if not defined GRADLE_USER_HOME if exist "D:\LolzCloud-Android-Toolchain\" set "GRADLE_USER_HOME=D:\LolzCloud-Android-Toolchain\gradle-cache"
if defined JAVA_HOME (
  set "JAVA_EXE=%JAVA_HOME%\bin\java.exe"
) else (
  set "JAVA_EXE=java.exe"
)
"%JAVA_EXE%" -classpath "%APP_DIR%gradle\wrapper\gradle-wrapper.jar" org.gradle.wrapper.GradleWrapperMain %*
exit /b %ERRORLEVEL%
