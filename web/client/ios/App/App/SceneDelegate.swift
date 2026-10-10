import UIKit
import Capacitor
#if canImport(GoogleSignIn)
import GoogleSignIn
#endif

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        // #0a0a0a behind the WebView so there is no white flash between launch screen and first paint.
        window?.backgroundColor = UIColor(red: 10 / 255, green: 10 / 255, blue: 10 / 255, alpha: 1)
        window?.overrideUserInterfaceStyle = .dark
        window?.rootViewController = CAPBridgeViewController()
        window?.makeKeyAndVisible()

        // Forwards cold-start URLs (applypilot://…, universal links) to @capacitor/app (appUrlOpen).
        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        #if canImport(GoogleSignIn)
        // Google Sign-In (@capgo/capacitor-social-login) redirect back into the app.
        if URLContexts.contains(where: { GIDSignIn.sharedInstance.handle($0.url) }) {
            return
        }
        #endif
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
