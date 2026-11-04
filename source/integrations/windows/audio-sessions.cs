// Read-only Windows Core Audio session meters. No audio buffers or microphones are opened.
// Interface order/IDs: microsoft/win32metadata, WinSDK audiopolicy.h,
// mmdeviceapi.h, endpointvolume.h and audioclient.h.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace LolzCloud.Audio {
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class DeviceEnumerator { }
    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IDeviceEnumerator {
        [PreserveSig] int EnumAudioEndpoints(int flow, uint mask, out IDeviceCollection devices);
    }
    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IDeviceCollection {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int Item(uint index, out IDevice device);
    }
    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IDevice {
        [PreserveSig] int Activate(ref Guid iid, uint context, IntPtr parameters, [MarshalAs(UnmanagedType.IUnknown)] out object value);
    }
    [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface ISessionManager {
        [PreserveSig] int GetAudioSessionControl(IntPtr guid, uint flags, out IntPtr control);
        [PreserveSig] int GetSimpleAudioVolume(IntPtr guid, uint flags, out IntPtr volume);
        [PreserveSig] int GetSessionEnumerator(out ISessionEnumerator sessions);
    }
    [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface ISessionEnumerator {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int GetSession(int index, out ISessionControl control);
    }
    [ComImport, Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface ISessionControl {
        [PreserveSig] int GetState(out int state);
    }
    [ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface ISessionControl2 {
        [PreserveSig] int GetState(out int state);
        [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
        [PreserveSig] int SetDisplayName(IntPtr name, IntPtr context);
        [PreserveSig] int GetIconPath(out IntPtr path);
        [PreserveSig] int SetIconPath(IntPtr path, IntPtr context);
        [PreserveSig] int GetGroupingParam(out Guid value);
        [PreserveSig] int SetGroupingParam(IntPtr value, IntPtr context);
        [PreserveSig] int RegisterAudioSessionNotification(IntPtr events);
        [PreserveSig] int UnregisterAudioSessionNotification(IntPtr events);
        [PreserveSig] int GetSessionIdentifier(out IntPtr id);
        [PreserveSig] int GetSessionInstanceIdentifier(out IntPtr id);
        [PreserveSig] int GetProcessId(out uint pid);
        [PreserveSig] int IsSystemSoundsSession();
        [PreserveSig] int SetDuckingPreference([MarshalAs(UnmanagedType.Bool)] bool optOut);
    }
    [ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMeter {
        [PreserveSig] int GetPeakValue(out float peak);
    }
    [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IVolume {
        [PreserveSig] int SetMasterVolume(float volume, IntPtr context);
        [PreserveSig] int GetMasterVolume(out float volume);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, IntPtr context);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }
    public class SessionPeak {
        public uint pid;
        public string name;
        public float peak;
        public int device;
    }
    public class MeterSample {
        public bool available;
        public SessionPeak[] sessions;
        public SessionPeak[] ownAudio;
    }
    public sealed class SessionMeters : IDisposable {
        sealed class Entry {
            public object owner;
            public ISessionControl2 control;
            public IMeter meter;
            public IVolume volume;
            public uint pid;
            public string name;
            public bool own;
            public int device;
        }
        readonly List<Entry> entries = new List<Entry>();
        readonly string excluded;
        readonly uint excludedPid;
        DateTime refreshed = DateTime.MinValue;
        bool available;
        public SessionMeters(string excludedName, uint ownPid) {
            excluded = (excludedName ?? "LolzCloud").ToLowerInvariant(); excludedPid = ownPid;
        }
        static void Release(object value) {
            if (value != null && Marshal.IsComObject(value)) { try { Marshal.ReleaseComObject(value); } catch { } }
        }
        void Clear() {
            foreach (Entry entry in entries) Release(entry.owner);
            entries.Clear();
        }
        void Refresh() {
            Clear(); refreshed = DateTime.UtcNow; available = false;
            IDeviceEnumerator enumerator = null; IDeviceCollection devices = null;
            try {
                enumerator = (IDeviceEnumerator)new DeviceEnumerator();
                Marshal.ThrowExceptionForHR(enumerator.EnumAudioEndpoints(0, 1, out devices));
                uint count; Marshal.ThrowExceptionForHR(devices.GetCount(out count)); available = count > 0;
                for (uint index = 0; index < count; index++) {
                    IDevice device = null; object managerObject = null; ISessionEnumerator sessions = null;
                    try {
                        if (devices.Item(index, out device) < 0) continue;
                        Guid iid = typeof(ISessionManager).GUID;
                        if (device.Activate(ref iid, 23, IntPtr.Zero, out managerObject) < 0) continue;
                        ISessionManager manager = (ISessionManager)managerObject;
                        if (manager.GetSessionEnumerator(out sessions) < 0) continue;
                        int sessionCount; if (sessions.GetCount(out sessionCount) < 0) continue;
                        for (int slot = 0; slot < Math.Min(sessionCount, 256); slot++) {
                            ISessionControl owner = null;
                            try {
                                if (sessions.GetSession(slot, out owner) < 0) continue;
                                ISessionControl2 control = (ISessionControl2)owner; uint pid;
                                if (control.GetProcessId(out pid) < 0 || pid == 0 || control.IsSystemSoundsSession() == 0) continue;
                                string name;
                                using (Process process = Process.GetProcessById((int)pid)) name = process.ProcessName;
                                bool own = pid == excludedPid || String.Equals(name, excluded, StringComparison.OrdinalIgnoreCase) || String.Equals(name, "LolzCloud", StringComparison.OrdinalIgnoreCase);
                                entries.Add(new Entry { owner = owner, control = control, meter = (IMeter)owner, volume = (IVolume)owner, pid = pid, name = name, own = own, device = (int)index });
                                owner = null; // Ownership transfers to the cached entry.
                            } catch { } finally { Release(owner); }
                        }
                    } catch { } finally { Release(sessions); Release(managerObject); Release(device); }
                }
            } finally { Release(devices); Release(enumerator); }
        }
        public MeterSample Read() {
            if ((DateTime.UtcNow - refreshed).TotalSeconds >= 2) Refresh();
            List<SessionPeak> result = new List<SessionPeak>();
            List<SessionPeak> ownAudio = new List<SessionPeak>();
            foreach (Entry entry in entries) {
                try {
                    int state; float peak, volume; bool mute;
                    if (entry.control.GetState(out state) < 0 || state != 1 || entry.meter.GetPeakValue(out peak) < 0) continue;
                    if (entry.volume.GetMute(out mute) < 0 || mute || entry.volume.GetMasterVolume(out volume) < 0 || volume <= 0) continue;
                    peak = Math.Min(1, Math.Max(0, peak * volume));
                    if (peak > 0.000001f) {
                        SessionPeak row = new SessionPeak { pid = entry.pid, name = entry.name, peak = peak, device = entry.device };
                        if (entry.own) ownAudio.Add(row); else result.Add(row);
                    }
                } catch { refreshed = DateTime.MinValue; }
            }
            return new MeterSample { available = available, sessions = result.ToArray(), ownAudio = ownAudio.ToArray() };
        }
        public void Dispose() { Clear(); }
    }
}
