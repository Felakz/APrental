@echo off
setlocal
set "JAVA_HOME=C:\Program Files\Microsoft\jdk-17.0.20.8-hotspot"
set "ANDROID_HOME=C:\Users\Lenovo\android-sdk"
set "PATH=%JAVA_HOME%\bin;%PATH%"

cd /d "c:\Users\Lenovo\Documents\Default Project\APPLOCAMOVIL\app"
echo ===================================================
echo Compilando APK con Gradle y Android Studio JBR...
echo JAVA_HOME: %JAVA_HOME%
echo ANDROID_HOME: %ANDROID_HOME%
echo ===================================================

call "c:\Users\Lenovo\Documents\Default Project\APPLOCAMOVIL\tools\gradle-8.7\bin\gradle.bat" assembleDebug --no-daemon
if %errorlevel% equ 0 (
    echo.
    echo ===================================================
    echo  COMPILACION EXITOSA: APK generado correctamente.
    echo ===================================================
) else (
    echo.
    echo ===================================================
    echo  ERROR EN LA COMPILACION.
    echo ===================================================
)
endlocal
