# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# The React Native AAR exposes DEBUG through a non-constant wrapper. For release
# builds, make the already-false value visible to R8 so development-only Metro
# branches and their emulator addresses can be removed from the APK.
-assumevalues class com.facebook.react.common.build.ReactBuildConfig {
    public static boolean DEBUG return false;
}

-assumevalues class com.facebook.react.BuildConfig {
    public static boolean DEBUG return false;
}
