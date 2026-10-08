package drHirsch.only_silk_touch_enderchest;

import net.minecraftforge.event.level.BlockEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;

/**
 * MinecraftForge entry point for the versions still on EventBus 6, replacing the
 * one under src/main/java for them (see gradle/mod-sources.gradle).
 *
 * Forge moved to EventBus 7 in Minecraft 1.21.6. That moved the SubscribeEvent
 * annotation into an api.listener package and
 * changed cancellable listeners from "void, then call setCanceled" to "return
 * true to cancel". src/main/java uses the newer form so that future Minecraft
 * releases need no overlay at all; this file covers the older, now finite half of
 * the supported range. The rule is the shared SilkTouch check from common/java in
 * both.
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
        public static void onBlockBreak(BlockEvent.BreakEvent event) {
            if (SilkTouch.shouldPreventBreaking(event.getPlayer(), event.getState())) {
                event.setCanceled(true);
            }
        }
    }
}
