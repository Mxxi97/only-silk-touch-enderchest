package drHirsch.only_silk_touch_enderchest;

import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.event.level.block.BreakBlockEvent;

/**
 * NeoForge entry point. The rule itself lives in {@link SilkTouch} under
 * common/java and is shared with the Fabric and Forge builds.
 *
 * This file targets the CURRENT NeoForge API (Minecraft 26.2 and newer), not the
 * oldest supported one, so that a new Minecraft release needs no new overlay in
 * the common case. The versions still on the older nested BlockEvent.BreakEvent
 * -- 1.21.x and 26.1.x -- are covered by the finite set of overlays under
 * src/versions (see gradle/mod-sources.gradle).
 *
 * BreakBlockEvent fires on both sides, so cancelling it here stops the break
 * animation from ever starting rather than letting the client break the block
 * and waiting for the server to correct it.
 */
@Mod(SilkTouch.MOD_ID)
public class OnlySilkTouchEnderchest {

    @EventBusSubscriber(modid = SilkTouch.MOD_ID)
    public static class Events {

        @SubscribeEvent
        public static void onBlockBreak(BreakBlockEvent event) {
            if (SilkTouch.shouldPreventBreaking(event.getPlayer(), event.getState())) {
                event.setCanceled(true);
            }
        }
    }
}
