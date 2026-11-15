import Foundation
import CoreFoundation

enum NativeRoomDelivery {
    static func mayEvaluate(event: String,applicationActive: Bool,pageReady: Bool,trustedParent: Bool,offline: Bool) -> Bool {
        guard pageReady,trustedParent,!offline else { return false }
        // An audible WK document can remain runnable in the background. Try
        // the bound command immediately; actual suspension still uses its TTL.
        return applicationActive || event=="room-command" || event=="room-command-result"
    }
}

// Room ownership is independent of the solo queue, settings revisions and
// provider frames. Only the trusted parent document can bind this policy.
struct NativeRoomTransport: Equatable {
    let roomID: String, documentID: String
    let epoch: Int, revision: Int, active: Bool
    let url: String, title: String, artist: String, cover: String
    let duration: Double, position: Double, playing: Bool
    let capabilities: [String:Bool]
    static let commands = Set(["play","pause","next","previous","seek"])
    static func boolean(_ value: Any?) -> Bool? {
        guard let value=value as? NSNumber,CFGetTypeID(value)==CFBooleanGetTypeID() else { return nil }
        return value.boolValue
    }
    init?(_ object: [String:Any]) {
        guard let room=object["roomId"] as? String,room.count==32,room.range(of:"^[a-f0-9]{32}$",options:.regularExpression) != nil,
              let document=object["documentId"] as? String,MediaPolicy.localIdentifier("local:"+document),
              let epoch=MediaPolicy.requestID(object["epoch"]),let revision=MediaPolicy.requestID(object["revision"]),
              let active=Self.boolean(object["active"]),let playback=object["playback"] as? [String:Any],
              let caps=object["capabilities"] as? [String:Any],Set(caps.keys)==Self.commands,
              let url=playback["url"] as? String,url.isEmpty || Self.mediaURL(url),
              let title=playback["title"] as? String,title.count<=300,
              let artist=playback["artist"] as? String,artist.count<=300,
              let cover=playback["cover"] as? String,cover.count<=2048,cover.isEmpty || Self.imageURL(cover),
              let duration=MediaPolicy.number(playback["duration"]),(0...86400).contains(duration),
              let position=MediaPolicy.number(playback["position"]),(0...86400).contains(position),
              let playing=Self.boolean(playback["playing"]) else { return nil }
        var capabilities=[String:Bool]()
        for (command,value) in caps { guard let flag=Self.boolean(value) else { return nil };capabilities[command]=flag }
        roomID=room;documentID=document;self.epoch=epoch;self.revision=revision;self.active=active
        self.url=url;self.title=title;self.artist=artist;self.cover=cover
        self.duration=duration;self.position=duration>0 ? min(position,duration):position;self.playing=playing
        self.capabilities=capabilities
    }
    private static func mediaURL(_ value: String) -> Bool {
        guard value.count<=500,value==value.trimmingCharacters(in:.whitespacesAndNewlines),let url=URLComponents(string:value),url.scheme=="https",
              url.port==nil,url.user==nil,url.password==nil,url.fragment==nil else { return false }
        if ["soundcloud.com","www.soundcloud.com","m.soundcloud.com"].contains(url.host ?? ""),url.query==nil,
           url.path.range(of:"^/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/?$",options:.regularExpression)==url.path.startIndex..<url.path.endIndex { return true }
        guard ["music.youtube.com","youtube.com","www.youtube.com"].contains(url.host ?? ""),url.path=="/watch",
              let items=url.queryItems,items.count==1,items[0].name=="v",let id=items[0].value,id.count==11,
              id.range(of:"^[A-Za-z0-9_-]{11}$",options:.regularExpression) != nil else { return false }
        return true
    }
    private static func imageURL(_ value: String) -> Bool {
        guard let url=URL(string:value) else { return false }
        return url.scheme=="https" && url.host != nil && url.user==nil && url.password==nil && (url.port==nil || url.port==443)
    }
    var owner: [String:Any] { ["roomId":roomID,"documentId":documentID,"epoch":epoch] }
    func matches(_ detail: [String:Any]) -> Bool {
        detail["roomId"] as? String==roomID && detail["documentId"] as? String==documentID && MediaPolicy.requestID(detail["epoch"])==epoch
    }
}

struct NativeRoomCommand {
    let id: String, command: String, value: Double?
    let generation: Int, client: String, request: Int
    let transport: NativeRoomTransport, createdAt: TimeInterval
    private(set) var deadline: TimeInterval
    private(set) var acceptedDelivery=false
    init(id: String,command: String,value: Double?,generation: Int,client: String,request: Int,transport: NativeRoomTransport,now: TimeInterval) {
        self.id=id;self.command=command;self.value=value;self.generation=generation;self.client=client;self.request=request
        self.transport=transport;createdAt=now;deadline=now+3
    }
    @discardableResult mutating func acceptDelivery(now: TimeInterval) -> Bool {
        guard now.isFinite,now<=deadline else { return false }
        if !acceptedDelivery { acceptedDelivery=true;deadline=min(now+60,createdAt+63) }
        return true
    }
    var detail: [String:Any] {
        var result=transport.owner;result.merge(["id":id,"command":command,"clientId":client,"requestId":request]) { _,new in new }
        if let value { result["value"]=value };return result
    }
}

struct NativeRoomBinding {
    enum Change: Equatable { case acquired, updated, released }
    private(set) var latest: NativeRoomTransport?
    private(set) var client="",request=0,generation=0
    private(set) var soloBlocked=false
    private var retired=[String]()
    var current: NativeRoomTransport? { latest?.active==true ? latest:nil }
    mutating func accept(_ next: NativeRoomTransport,client: String,request: Int) -> Change? {
        guard MediaPolicy.localIdentifier("local:"+client),(1...9_007_199_254_740_991).contains(request),!retired.contains(next.documentID) else { return nil }
        if let previous=latest {
            if previous.documentID==next.documentID {
                guard previous.roomID==next.roomID,next.epoch>=previous.epoch else { return nil }
                if next.epoch==previous.epoch && next.revision==previous.revision {
                    guard next==previous else { return nil }
                    self.client=client;self.request=request;return .updated
                }
                if next.epoch==previous.epoch { guard previous.active,next.revision>previous.revision else { return nil } }
                else { guard !previous.active,next.active else { return nil } }
                if !next.active { guard previous.active,next.epoch==previous.epoch else { return nil } }
            } else {
                guard next.active else { return nil }
                retired.append(previous.documentID);if retired.count>32 { retired.removeFirst() }
            }
        } else { guard next.active else { return nil } }
        let previous=current
        latest=next;self.client=client;self.request=request;soloBlocked=true
        if !next.active { generation+=1;return .released }
        if previous?.documentID != next.documentID || previous?.epoch != next.epoch { generation+=1;return .acquired }
        return .updated
    }
    // Explicit solo UI is the only operation that removes the post-room fence.
    // Release itself never permits a stale system Play/Next to resume old audio.
    @discardableResult mutating func chooseSolo() -> Bool {
        guard current==nil else { return false };soloBlocked=false;generation+=1;return true
    }
    // Called only after the native shell has permanently suspended WebKit
    // media. A late completion must not retire a newer room/solo selection.
    @discardableResult mutating func retireForOffline(expectedGeneration: Int) -> Bool {
        guard generation==expectedGeneration else { return false }
        if let latest,!retired.contains(latest.documentID) {
            retired.append(latest.documentID);if retired.count>32 { retired.removeFirst() }
        }
        latest=nil;soloBlocked=true;generation+=1;return true
    }
    mutating func parentDocumentReplaced() {
        guard let latest else { return }
        if !retired.contains(latest.documentID) { retired.append(latest.documentID);if retired.count>32 { retired.removeFirst() } }
        self.latest=nil;generation+=1
        // Preserve the post-room fence, but a playing solo owner must survive
        // a UI reload after it explicitly took over from the former room.
    }
    func command(_ name: String,value: Double?,now: TimeInterval,id: String=UUID().uuidString.lowercased()) -> NativeRoomCommand? {
        guard now.isFinite,let current,current.capabilities[name]==true,MediaPolicy.localIdentifier("local:"+id) else { return nil }
        if name=="seek" { guard let value,value.isFinite,value>=0,value<=86400 else { return nil } }
        else { guard value==nil else { return nil } }
        return NativeRoomCommand(id:id,command:name,value:name=="seek" ? min(value!,current.duration>0 ? current.duration:86400):nil,generation:generation,client:client,request:request,transport:current,now:now)
    }
    func owns(_ command: NativeRoomCommand,now: TimeInterval) -> Bool {
        guard now.isFinite,now<=command.deadline,command.generation==generation,command.client==client,command.request==request,let current else { return false }
        return current.documentID==command.transport.documentID && current.roomID==command.transport.roomID && current.epoch==command.transport.epoch
    }
}
