plugins {
    id("com.android.application")
    kotlin("android")
}

android {
    namespace = "mw.enrolla.smsforwarder"
    compileSdk = 34
    defaultConfig {
        applicationId = "mw.enrolla.smsforwarder"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
    }
    buildTypes {
        release {
            isMinifyEnabled = true
            // Sign with your own keystore; this APK is sideloaded (Google Play does not allow SMS-reading apps like this).
        }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation(project(":core"))
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
}
