package drHirsch.only_silk_touch_enderchest;

import net.minecraftforge.event.level.BlockEvent;
import net.minecraftforge.eventbus.api.listener.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;

/**
 * MinecraftForge entry point. The rule itself lives in {@link SilkTouch} under
 * common/java and is shared with the NeoForge and Fabric builds.
 *
 * This file targets the CURRENT Forge API (EventBus 7), not the oldest supported
 * one, so that a new Minecraft release needs no new overlay in the common case.
 * Under EventBus 7 a cancellable listener is a predicate: returning true cancels
 * the event, which is why this method returns the check directly instead of
 * calling setCanceled. The versions still on EventBus 6 are covered by the
 * overlay under src/versions.
 *
 * BreakEvent fires on the server, which is the only side that can actually refuse
 * the break: the client plays its own break animation first and is corrected by
 * the block update the server sends when the event is cancelled.
 */
@Mod(SilkTouch.MOD_ID)
public class OnlySilkTouchEnderchest {

    @Mod.EventBusSubscriber(modid = SilkTouch.MOD_ID)
    public static class Events {

        @SubscribeEvent
        public static boolean onBlockBreak(BlockEvent.BreakEvent event) {
            return SilkTouch.shouldPreventBreaking(event.getPlayer(), event.getState());
        }
    }
}
