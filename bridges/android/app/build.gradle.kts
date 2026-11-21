import java.io.File

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val nexoraWebUrl: String = (
    (project.findProperty("NEXORA_WEB_URL") as String?)?.takeIf { it.isNotBlank() }
        ?: System.getenv("NEXORA_WEB_URL")?.takeIf { it.isNotBlank() }
        ?: System.getenv("PUBLIC_APP_URL")?.takeIf { it.isNotBlank() }
        ?: System.getenv("APP_URL")?.takeIf { it.isNotBlank() && it != "MY_APP_URL" }
        ?: ""
).trim().trimEnd('/')

val nexoraVersionName: String = (
    (project.findProperty("NEXORA_VERSION_NAME") as String?)?.takeIf { it.isNotBlank() }
        ?: System.getenv("NEXORA_VERSION_NAME")?.takeIf { it.isNotBlank() }
        ?: "1.0.0"
).removePrefix("v").trim()

val nexoraVersionCode: Int = (
    (project.findProperty("NEXORA_VERSION_CODE") as String?)?.takeIf { it.isNotBlank() }
        ?: System.getenv("NEXORA_VERSION_CODE")?.takeIf { it.isNotBlank() }
        ?: "1"
).toIntOrNull() ?: 1

android {
    namespace = "com.nexora.ai"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.nexora.ai"
        minSdk = 24
        targetSdk = 35
        versionCode = nexoraVersionCode
        versionName = nexoraVersionName

        buildConfigField("String", "NEXORA_APP_URL", "\"$nexoraWebUrl\"")
    }

    val keystorePath = System.getenv("ANDROID_KEYSTORE_PATH")
        ?: (project.findProperty("ANDROID_KEYSTORE_PATH") as String?)
    val keystorePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
        ?: (project.findProperty("ANDROID_KEYSTORE_PASSWORD") as String?)
    val keyAliasName = System.getenv("ANDROID_KEY_ALIAS")
        ?: (project.findProperty("ANDROID_KEY_ALIAS") as String?)
    val keyPasswordValue = System.getenv("ANDROID_KEY_PASSWORD")
        ?: (project.findProperty("ANDROID_KEY_PASSWORD") as String?)

    signingConfigs {
        if (!keystorePath.isNullOrBlank() &&
            !keystorePassword.isNullOrBlank() &&
            !keyAliasName.isNullOrBlank() &&
            !keyPasswordValue.isNullOrBlank() &&
            File(keystorePath).exists()
        ) {
            create("release") {
                storeFile = File(keystorePath)
                storePassword = keystorePassword
                keyAlias = keyAliasName
                keyPassword = keyPasswordValue
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            val releaseSign = signingConfigs.findByName("release")
            if (releaseSign != null) {
                signingConfig = releaseSign
            }
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
}
