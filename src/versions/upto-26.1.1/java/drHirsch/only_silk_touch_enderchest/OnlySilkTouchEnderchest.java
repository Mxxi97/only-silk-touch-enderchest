package drHirsch.only_silk_touch_enderchest;

import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.event.level.BlockEvent;

/**
 * NeoForge entry point for every Minecraft version up to and including 26.1.1,
 * replacing the one under src/main/java for those versions (see
 * gradle/mod-sources.gradle).
 *
 * NeoForge split the nested BlockEvent.BreakEvent out into a top-level
 * BreakBlockEvent in Minecraft 26.1.2. src/main/java uses the newer type so that
 * future Minecraft releases need no overlay at all; this file keeps the older,
 * now finite half of the supported range working. Only the event type differs --
 * the rule is the shared SilkTouch check from common/java.
 *
 * BreakEvent fires on the server, which is the only side that can actually
 * refuse the break: the client plays its own break animation first and is
 * corrected by the block update the server sends when the event is cancelled.
 */
@Mod(SilkTouch.MOD_ID)
public class OnlySilkTouchEnderchest {

    @EventBusSubscriber(modid = SilkTouch.MOD_ID)
    public static class Events {

        @SubscribeEvent
        public static void onBlockBreak(BlockEvent.BreakEvent event) {
            if (SilkTouch.shouldPreventBreaking(event.getPlayer(), event.getState())) {
                event.setCanceled(true);
            }
        }
    }
}
