import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Clock, Crown, Image, MapPin, Pencil, Shield, Upload, UserMinus, Users, X } from "lucide-react";
import { useRoomStore } from "../stores/roomStore";
import Modal from "./Modal";
import { useSocket } from "../hooks/useSocket";
import { fileToAvatarDataUrl, getSafeAvatarUrl, isSupportedAvatarFile, resolveRoomAvatarUrl } from "../lib/avatarImage";
import { getDisplayInitial } from "../lib/displayInitial";
import ChatImageLightbox from "./ChatImageLightbox";
import { formatStayDuration } from "../lib/formatStayDuration";
import { formatDisplayLocation } from "../lib/clientNetworkInfo";
import ConfirmModal from "./ConfirmModal";
import Tooltip from "./Tooltip";
import TruncateTip from "./TruncateTip";
import UserRoleMarks from "./UserRoleMarks";
import type { RoomUser } from "../types";
import { useScrollToTopOnPageChange } from "../hooks/useScrollToTopOnPageChange";

const USERS_PAGE_SIZE = 50;

interface Props {
  users: RoomUser[];
  creatorId?: string | null;
  memberTiers?: Record<string, { badgeLabel: string; badgeColor: string }>;
  onNotice?: (message: string, type: "success" | "error") => void;
}

type DisplayUser = RoomUser & { offline?: boolean };

type PendingAction = { type: "kick"; user: DisplayUser } | { type: "admin"; user: DisplayUser; admin: boolean };

export default function OnlineUsers({ users, creatorId, memberTiers = {}, onNotice }: Props) {
  const mySocketId = useRoomStore((s) => s.mySocketId);
  const isOwner = useRoomStore((s) => s.isOwner);
  const isAdmin = useRoomStore((s) => s.isAdmin);
  const canModerate = isOwner || isAdmin;
  const hideIpLocation = useRoomStore((s) => Boolean(s.room?.hideIpLocation));
  const adminIds = useRoomStore((s) => s.room?.adminIds) || [];
  const autoPromotedAdminIds = useRoomStore((s) => s.room?.autoPromotedAdminIds) || [];
  const ownerId = useRoomStore((s) => s.room?.ownerId) || null;
  const userNicknames = useRoomStore((s) => s.room?.userNicknames) || {};
  const nickname = useRoomStore((s) => s.nickname);
  const { renameUser, kickUser, setRoomAdmin, setUserAvatar } = useSocket();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(nickname);
  const [saving, setSaving] = useState(false);
  const [kickingId, setKickingId] = useState<string | null>(null);
  const [adminTogglingId, setAdminTogglingId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [avatarDraft, setAvatarDraft] = useState("");
  const [avatarError, setAvatarError] = useState("");
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [previewAvatarUrl, setPreviewAvatarUrl] = useState<string | null>(null);
  const [avatarPickOnOpen, setAvatarPickOnOpen] = useState(false);
  const userAvatarUrls = useRoomStore((s) => s.room?.userAvatarUrls) || {};
  const avatar_url = useRoomStore((s) => s.avatar_url);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const avatarFileInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const getUserAvatar = (userId: string) => {
    if (userId === mySocketId) return resolveRoomAvatarUrl(avatar_url, userAvatarUrls[userId]);
    return getSafeAvatarUrl(userAvatarUrls[userId]);
  };

  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, [open]);

  const visibleUsers = useMemo(() => users.filter((user) => !user.readOnly), [users]);

  const orderedUsers = useMemo<DisplayUser[]>(() => {
    const onlineIds = new Set(visibleUsers.map((user) => user.id));
    const offlineAdmins: DisplayUser[] = isOwner
      ? adminIds
          .filter((id) => !onlineIds.has(id) && id !== creatorId)
          .map((id) => ({
            id,
            nickname: userNicknames[id] || `用户${id.slice(-4)}`,
            joinedAt: 0,
            offline: true,
          }))
      : [];

    return [...visibleUsers.map((user) => ({ ...user, offline: false as const })), ...offlineAdmins].sort((a, b) => {
      if (a.id === mySocketId) return -1;
      if (b.id === mySocketId) return 1;
      if (creatorId) {
        if (a.id === creatorId) return -1;
        if (b.id === creatorId) return 1;
      }
      if (a.offline !== b.offline) return a.offline ? 1 : -1;
      return a.joinedAt - b.joinedAt;
    });
  }, [visibleUsers, mySocketId, creatorId, adminIds, userNicknames, isOwner]);

  const totalPages = Math.max(1, Math.ceil(orderedUsers.length / USERS_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedUsers = orderedUsers.slice(
    (currentPage - 1) * USERS_PAGE_SIZE,
    currentPage * USERS_PAGE_SIZE,
  );
  useScrollToTopOnPageChange(currentPage, listRef);

  useEffect(() => {
    setPage((current) => open ? Math.min(current, totalPages) : 1);
  }, [open, totalPages]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
      setEditing(false);
      setError("");
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    setDraftName(nickname);
  }, [nickname]);

  useEffect(() => {
    return () => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!showAvatarModal || !avatarPickOnOpen) return;
    setAvatarPickOnOpen(false);
    const timer = window.setTimeout(() => avatarFileInputRef.current?.click(), 0);
    return () => window.clearTimeout(timer);
  }, [showAvatarModal, avatarPickOnOpen]);

  const saveNickname = async () => {
    const nextName = draftName.trim();
    if (!nextName || saving) return;

    setSaving(true);
    setError("");
    const res = await renameUser(nextName);
    if (res.success) {
      setEditing(false);
    } else {
      setError(res.error || "改名失败");
    }
    setSaving(false);
  };

  const handleKick = (user: DisplayUser) => {
    if (!canModerate || kickingId || user.offline) return;
    setPendingAction({ type: "kick", user });
  };

  const handleToggleAdmin = (user: DisplayUser) => {
    if (!isOwner || adminTogglingId) return;
    const nextAdmin = !adminIds.includes(user.id);
    setPendingAction({ type: "admin", user, admin: nextAdmin });
  };

  const executePendingAction = async () => {
    if (!pendingAction) return;

    if (pendingAction.type === "kick") {
      const user = pendingAction.user;
      setKickingId(user.id);
      setError("");
      const res = await kickUser(user.id);
      setPendingAction(null);
      if (res.success) {
        onNotice?.(res.message || `已移出「${user.nickname}」`, "success");
      } else {
        const msg = res.error || "踢出失败";
        setError(msg);
        onNotice?.(msg, "error");
      }
      setKickingId(null);
      return;
    }

    const user = pendingAction.user;
    setAdminTogglingId(user.id);
    setError("");
    const res = await setRoomAdmin(user.id, pendingAction.admin);
    setPendingAction(null);
    if (res.success) {
      onNotice?.(res.message || (pendingAction.admin ? `已将「${user.nickname}」设为管理员` : `已取消「${user.nickname}」的管理员`), "success");
    } else {
      const msg = res.error || "设置管理员失败";
      setError(msg);
      onNotice?.(msg, "error");
    }
    setAdminTogglingId(null);
  };

  const clearAvatarClickTimer = () => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
  };

  const openAvatarFilePicker = () => {
    avatarFileInputRef.current?.click();
  };

  const openAvatarSettings = (pickFile = false) => {
    setAvatarDraft(getSafeAvatarUrl(avatar_url));
    setAvatarError("");
    setAvatarPickOnOpen(pickFile);
    setShowAvatarModal(true);
  };

  /** 他人头像：单击查看 */
  const handleAvatarPreview = (url: string) => {
    clearAvatarClickTimer();
    clickTimerRef.current = setTimeout(() => setPreviewAvatarUrl(url), 220);
  };

  /** 自己头像：单击选择文件（打开设置并弹出文件选择） */
  const handleOwnAvatarClick = () => {
    clearAvatarClickTimer();
    clickTimerRef.current = setTimeout(() => openAvatarSettings(true), 220);
  };

  /** 自己头像：双击查看 */
  const handleOwnAvatarDoubleClick = () => {
    clearAvatarClickTimer();
    if (avatar_url) setPreviewAvatarUrl(avatar_url);
  };

  /** 设置弹窗内头像：单击选择文件 */
  const handleModalAvatarClick = () => {
    clearAvatarClickTimer();
    clickTimerRef.current = setTimeout(() => openAvatarFilePicker(), 220);
  };

  /** 设置弹窗内头像：双击查看 */
  const handleModalAvatarDoubleClick = () => {
    clearAvatarClickTimer();
    if (avatarDraft) setPreviewAvatarUrl(avatarDraft);
  };

  const handleAvatarFile = async (file: File | undefined) => {
    if (!file) return;
    if (!isSupportedAvatarFile(file)) {
      setAvatarError("仅支持 JPG / PNG 图片");
      setShowAvatarModal(true);
      return;
    }
    setAvatarError("");
    try {
      setAvatarDraft(await fileToAvatarDataUrl(file));
      setShowAvatarModal(true);
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : "图片处理失败");
      setShowAvatarModal(true);
    }
  };

  const saveAvatar = async () => {
    if (avatarSaving) return;
    const url = getSafeAvatarUrl(avatarDraft);
    if (avatarDraft.trim() && !url) {
      setAvatarError("头像格式不支持或图片过大");
      return;
    }
    setAvatarSaving(true);
    const res = await setUserAvatar(url);
    setAvatarSaving(false);
    if (!res.success) {
      setAvatarError(res.error || "头像保存失败");
      return;
    }
    localStorage.setItem("avatar_url", url);
    useRoomStore.setState({ avatar_url: url });
    setShowAvatarModal(false);
  };

  const canKick = (user: DisplayUser) =>
    canModerate &&
    !user.offline &&
    user.id !== mySocketId &&
    user.id !== creatorId &&
    !adminIds.includes(user.id) &&
    (isOwner || !autoPromotedAdminIds.includes(user.id));

  const canToggleAdmin = (user: DisplayUser) => isOwner && user.id !== mySocketId && user.id !== creatorId && !user.readOnly;

  return (
    <div className="relative" ref={panelRef}>
      <Tooltip content="查看房间用户" side="bottom">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-xs text-netease-muted hover:bg-netease-card hover:text-white transition-colors"
          aria-label="查看房间用户"
        >
          <Users className="w-4 h-4" />
          <div className="flex -space-x-2">
            {orderedUsers.slice(0, 5).map((user) => (
              <Tooltip key={user.id} content={user.id === creatorId ? `${user.nickname}（房主）` : user.nickname} side="bottom">
                <div
                  className={`relative w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white border-2 border-netease-dark ${
                    getUserAvatar(user.id)
                      ? ""
                      : user.id === creatorId
                        ? "bg-gradient-to-br from-amber-500 to-orange-600"
                        : user.id === mySocketId
                          ? "bg-gradient-to-br from-netease-red to-pink-500"
                          : "bg-gradient-to-br from-zinc-500 to-zinc-700"
                  }`}
                >
                  {getUserAvatar(user.id) ? (
                    <img src={getUserAvatar(user.id)} alt="" className="w-full h-full rounded-full object-cover" />
                  ) : (
                    getDisplayInitial(user.nickname)
                  )}
                  {user.id === creatorId && <Crown className="absolute -top-1 -right-1 w-3 h-3 text-amber-300" />}
                </div>
              </Tooltip>
            ))}
            {orderedUsers.length > 5 && (
              <div className="w-7 h-7 rounded-full bg-netease-card flex items-center justify-center text-[10px] text-white border-2 border-netease-dark">
                +{orderedUsers.length - 5}
              </div>
            )}
          </div>
          <span className="hidden sm:inline">共 {visibleUsers.length} 人</span>
        </button>
      </Tooltip>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 rounded-2xl border border-netease-border/70 bg-netease-dark/95 p-3 shadow-2xl backdrop-blur z-30">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-white">房间用户</h3>
              <p className="text-[11px] text-netease-muted">共 {visibleUsers.length} 人</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setEditing(false);
              }}
              className="rounded-lg p-1 text-netease-muted hover:bg-white/10 hover:text-white"
              aria-label="关闭用户列表"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div ref={listRef} className="max-h-80 space-y-1.5 overflow-y-auto pr-0.5">
            {pagedUsers.map((user) => {
              const isMe = user.id === mySocketId;
              const isRoomCreator = Boolean(creatorId && user.id === creatorId);
              const isAppointedAdmin = adminIds.includes(user.id);
              const isTempAdmin = autoPromotedAdminIds.includes(user.id) || Boolean(ownerId && user.id === ownerId && !isRoomCreator && !isAppointedAdmin);
              const showAdminBadge = (isAppointedAdmin || isTempAdmin) && !isRoomCreator;

              return (
                <div
                  key={user.id}
                  className={`rounded-xl border px-2.5 py-2 ${isMe ? "border-netease-red/30 bg-netease-red/10" : "border-white/5 bg-white/[0.03]"}`}
                >
                  <div className="flex items-center gap-2">
                    {(() => {
                      const avatarUrl = getUserAvatar(user.id);
                      const avatarNode = (
                        <div
                          onClick={() => {
                            if (isMe && !user.offline) {
                              handleOwnAvatarClick();
                              return;
                            }
                            if (avatarUrl) handleAvatarPreview(avatarUrl);
                          }}
                          onDoubleClick={
                            isMe
                              ? handleOwnAvatarDoubleClick
                              : avatarUrl
                                ? () => {
                                    clearAvatarClickTimer();
                                    setPreviewAvatarUrl(avatarUrl);
                                  }
                                : undefined
                          }
                          className={`group relative w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 ${
                            isMe || avatarUrl ? "cursor-pointer" : ""
                          } ${
                            avatarUrl
                              ? ""
                              : isRoomCreator
                                ? "bg-gradient-to-br from-amber-500 to-orange-600"
                                : isMe
                                  ? "bg-gradient-to-br from-netease-red to-pink-500"
                                  : "bg-gradient-to-br from-zinc-500 to-zinc-700"
                          }`}
                        >
                          {avatarUrl ? (
                            <img src={avatarUrl} alt="" className="w-full h-full rounded-full object-cover" />
                          ) : (
                            getDisplayInitial(user.nickname)
                          )}
                          {isMe && (
                            <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                              <Image className="w-3.5 h-3.5 text-white" />
                            </div>
                          )}
                          {isRoomCreator && <Crown className="absolute -top-1 -right-1 w-3 h-3 text-amber-300" />}
                        </div>
                      );

                      if (isMe) {
                        return (
                          <Tooltip content="双击查看" side="bottom">
                            {avatarNode}
                          </Tooltip>
                        );
                      }
                      return avatarNode;
                    })()}

                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <TruncateTip text={user.nickname} as="p" className="min-w-0 flex-1 truncate text-sm text-white" />
                        {isMe && (
                          <span className="flex-shrink-0 whitespace-nowrap rounded-full bg-netease-red/20 px-1.5 py-0 text-[9px] leading-4 text-netease-red">
                            我
                          </span>
                        )}
                        <UserRoleMarks
                          isOwner={isRoomCreator}
                          isAdmin={showAdminBadge}
                          memberTier={memberTiers[user.id]}
                        />
                        {user.offline && (
                          <span className="flex-shrink-0 whitespace-nowrap rounded-full bg-white/8 px-1.5 py-0 text-[9px] leading-4 text-netease-muted">
                            离线
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[10px] text-netease-muted/70">
                        {!user.offline && user.joinedAt > 0 && (
                          <span className="inline-flex flex-shrink-0 items-center gap-0.5 whitespace-nowrap">
                            <Clock className="h-3 w-3 flex-shrink-0" />
                            <span>{formatStayDuration(user.joinedAt, now)}</span>
                          </span>
                        )}
                        {!user.offline && !hideIpLocation && (
                          <span className="inline-flex min-w-0 items-center gap-0.5">
                            <MapPin className="h-3 w-3 flex-shrink-0" />
                            <span className="truncate">{formatDisplayLocation(user.location)}</span>
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-shrink-0 items-center">
                      {isMe && !editing && !user.offline && (
                        <button
                          type="button"
                          onClick={() => {
                            setDraftName(user.nickname);
                            setEditing(true);
                          }}
                          className="rounded-lg p-1.5 text-netease-muted hover:bg-white/10 hover:text-white"
                          aria-label="修改昵称"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {canToggleAdmin(user) && (
                        <Tooltip content={isAppointedAdmin ? "取消管理员" : "设为管理员"}>
                          <button
                            type="button"
                            onClick={() => handleToggleAdmin(user)}
                            disabled={adminTogglingId === user.id}
                            className={`rounded-lg p-1.5 transition-colors disabled:opacity-40 ${
                              isAppointedAdmin ? "bg-sky-400/15 text-sky-300" : "text-netease-muted hover:bg-sky-400/10 hover:text-sky-300"
                            }`}
                            aria-label={isAppointedAdmin ? "取消管理员" : "设为管理员"}
                          >
                            <Shield className="w-3.5 h-3.5" />
                          </button>
                        </Tooltip>
                      )}

                      {canKick(user) && (
                        <Tooltip content="踢出">
                          <button
                            type="button"
                            onClick={() => handleKick(user)}
                            disabled={kickingId === user.id}
                            className="rounded-lg p-1.5 text-netease-muted hover:bg-red-500/10 hover:text-red-300 transition-colors disabled:opacity-40"
                            aria-label="踢出"
                          >
                            <UserMinus className="w-3.5 h-3.5" />
                          </button>
                        </Tooltip>
                      )}
                    </div>
                  </div>

                  {isMe && editing && (
                    <div className="mt-2 flex gap-1.5">
                      <input
                        value={draftName}
                        onChange={(event) => setDraftName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void saveNickname();
                          if (event.key === "Escape") setEditing(false);
                        }}
                        maxLength={20}
                        className="min-w-0 flex-1 rounded-lg border border-netease-border/60 bg-netease-dark px-2 py-1 text-xs text-white outline-none focus:border-netease-red/50"
                        placeholder="输入新昵称"
                        autoFocus
                      />
                      <Tooltip content="保存昵称">
                        <button
                          type="button"
                          onClick={saveNickname}
                          disabled={saving || !draftName.trim()}
                          className="rounded-lg bg-netease-red px-2 text-white disabled:opacity-40"
                          aria-label="保存昵称"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      </Tooltip>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="mt-2 flex items-center justify-between gap-2 border-t border-white/10 pt-2 text-xs text-netease-muted">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setPage(currentPage - 1)}
                className="rounded-lg px-2 py-1 hover:bg-white/10 hover:text-white disabled:opacity-30"
              >
                上一页
              </button>
              <span>{currentPage} / {totalPages}</span>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setPage(currentPage + 1)}
                className="rounded-lg px-2 py-1 hover:bg-white/10 hover:text-white disabled:opacity-30"
              >
                下一页
              </button>
            </div>
          )}
          {error && <p className="mt-2 text-xs text-netease-red">{error}</p>}
        </div>
      )}

      {pendingAction?.type === "kick" && (
        <ConfirmModal
          title="移出用户"
          message={
            <>
              确定将「{pendingAction.user.nickname}」移出房间吗？
              <br />
              <span className="text-netease-muted">被移出的用户将无法再次进入本房间。</span>
            </>
          }
          confirmLabel="移出"
          confirmVariant="danger"
          loading={kickingId === pendingAction.user.id}
          onConfirm={() => void executePendingAction()}
          onCancel={() => setPendingAction(null)}
        />
      )}

      {pendingAction?.type === "admin" && (
        <ConfirmModal
          title={pendingAction.admin ? "设为管理员" : "取消管理员"}
          message={
            pendingAction.admin
              ? `确定将「${pendingAction.user.nickname}」设为管理员吗？管理员可控制播放、切歌与审批。`
              : `确定取消「${pendingAction.user.nickname}」的管理员权限吗？`
          }
          confirmLabel={pendingAction.admin ? "设为管理员" : "取消管理员"}
          confirmVariant="primary"
          loading={adminTogglingId === pendingAction.user.id}
          onConfirm={() => void executePendingAction()}
          onCancel={() => setPendingAction(null)}
        />
      )}

      <ChatImageLightbox imageUrl={previewAvatarUrl} onClose={() => setPreviewAvatarUrl(null)} />

      <input
        ref={avatarFileInputRef}
        type="file"
        accept="image/jpeg,image/png"
        className="hidden"
        onChange={(event) => {
          void handleAvatarFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />

      <Modal open={showAvatarModal} onClose={() => setShowAvatarModal(false)}>
        <h3 className="text-base font-medium text-white mb-4">设置头像</h3>
        <div className="flex items-center gap-4">
          <Tooltip content="双击查看" side="bottom">
            <div
              role="button"
              tabIndex={0}
              onClick={handleModalAvatarClick}
              onDoubleClick={handleModalAvatarDoubleClick}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openAvatarFilePicker();
                }
              }}
              className="group relative flex h-20 w-20 flex-shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-white/10 bg-white/5"
              aria-label="单击选择文件，双击查看"
            >
              {avatarDraft ? (
                <img src={avatarDraft} alt="头像预览" className="h-full w-full object-cover" />
              ) : (
                <span className="text-lg font-bold text-white/60">{getDisplayInitial(nickname)}</span>
              )}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                <Upload className="w-5 h-5 text-white" />
              </div>
            </div>
          </Tooltip>
          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={openAvatarFilePicker}
              className="inline-flex items-center gap-1.5 rounded-lg border border-netease-border/60 px-3 py-1.5 text-sm text-white hover:bg-white/10 transition-colors"
            >
              <Upload className="w-3.5 h-3.5" />
              选择图片
            </button>
            <p className="mt-2 text-[11px] text-netease-muted">单击选择文件，双击查看。支持 JPG / PNG，自动裁剪为正方形并压缩</p>
          </div>
        </div>
        {avatarError && <p className="mt-3 text-xs text-netease-red">{avatarError}</p>}
        <div className="mt-4 flex justify-end gap-2">
          {avatarDraft && (
            <button
              type="button"
              onClick={() => setAvatarDraft("")}
              className="mr-auto rounded-lg px-3 py-1.5 text-sm text-netease-muted hover:bg-red-500/10 hover:text-red-300 transition-colors"
            >
              移除头像
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowAvatarModal(false)}
            className="rounded-lg px-4 py-1.5 text-sm text-netease-muted hover:bg-white/10 hover:text-white transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={saveAvatar}
            disabled={avatarSaving || avatarDraft === avatar_url}
            className="rounded-lg bg-netease-red px-4 py-1.5 text-sm text-white hover:bg-netease-red/90 transition-colors disabled:opacity-40"
          >
            {avatarSaving ? "保存中…" : "保存"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
