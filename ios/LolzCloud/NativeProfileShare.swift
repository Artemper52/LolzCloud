import Foundation
import UIKit
import WebKit

@MainActor final class NativeProfileShare {
    var emit: ((String,[String:Any]) -> Void)?
    private var active: UUID?
    private var directory: URL?
    func present(json: String, filename: String, operationId: String, webView: WKWebView) throws {
        guard active == nil else { throw UserError.message("Сначала закрой предыдущее окно сохранения.") }
        let data = try PortableProfileFile.data(json:json,filename:filename,operationID:operationId)
        guard UIApplication.shared.applicationState == .active, let window = webView.window, var presenter = window.rootViewController else { throw UserError.message("Открой приложение и повтори сохранение профиля.") }
        while let presented = presenter.presentedViewController { presenter = presented }
        guard !presenter.isBeingDismissed, !presenter.isBeingPresented else { throw UserError.message("Дождись закрытия текущего окна и повтори.") }
        let ticket = UUID(), folder = FileManager.default.temporaryDirectory.appendingPathComponent("LolzCloud-profile-"+ticket.uuidString,isDirectory:true)
        try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:false,attributes:[.posixPermissions:0o700])
        let file = folder.appendingPathComponent(filename)
        do {
            try data.write(to:file,options:.atomic)
            try FileManager.default.setAttributes([.protectionKey:FileProtectionType.completeUntilFirstUserAuthentication],ofItemAtPath:file.path)
        } catch { try? FileManager.default.removeItem(at:folder);throw error }
        active = ticket;directory = folder
        let activity = UIActivityViewController(activityItems:[file],applicationActivities:nil)
        if let popover = activity.popoverPresentationController {
            popover.sourceView = webView
            popover.sourceRect = CGRect(x:webView.bounds.midX,y:webView.bounds.midY,width:1,height:1)
            popover.permittedArrowDirections = []
        }
        activity.completionWithItemsHandler = { [weak self] _,completed,_,error in
            Task { @MainActor in
                try? FileManager.default.removeItem(at:folder)
                guard let self, self.active == ticket else { return }
                self.active = nil;self.directory = nil
                var detail: [String:Any] = ["state":error == nil ? completed ? "shared":"cancelled":"error","operationId":operationId]
                if error != nil {detail["error"]="Не удалось сохранить файл. Повтори попытку."}
                self.emit?("profileExport",detail)
            }
        }
        presenter.present(activity,animated:true)
        emit?("profileExport",["state":"sharing","operationId":operationId])
    }
}
