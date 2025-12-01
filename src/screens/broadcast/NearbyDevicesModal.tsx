import React, { useEffect, useRef } from 'react';
import {
    View,
    Text,
    Modal,
    StyleSheet,
    TouchableOpacity,
    TouchableWithoutFeedback,
    Animated,
    FlatList,
    PanResponder,
    Dimensions,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const MODAL_HEIGHT = SCREEN_HEIGHT * 0.45;

interface Device {
    id: string;
    name: string;
    isFriend: boolean;
    isConnected: boolean;
}

interface NearbyDevicesModalProps {
    visible: boolean;
    onClose: () => void;
    devices: Device[];
    onMessage: (deviceId: string) => void;
    onAddFriend: (deviceId: string) => void;
}

const NearbyDevicesModal: React.FC<NearbyDevicesModalProps> = ({
    visible,
    onClose,
    devices,
    onMessage,
    onAddFriend,
}) => {
    const translateY = useRef(new Animated.Value(MODAL_HEIGHT)).current;
    const backdropOpacity = useRef(new Animated.Value(0)).current;

    const panResponder = useRef(
        PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onMoveShouldSetPanResponder: (_, gestureState) => {
                return Math.abs(gestureState.dy) > 5;
            },
            onPanResponderMove: (_, gestureState) => {
                if (gestureState.dy > 0) {
                    translateY.setValue(gestureState.dy);
                }
            },
            onPanResponderRelease: (_, gestureState) => {
                if (gestureState.dy > 100 || gestureState.vy > 0.5) {
                    closeModal();
                } else {
                    Animated.spring(translateY, {
                        toValue: 0,
                        useNativeDriver: true,
                        tension: 65,
                        friction: 11,
                    }).start();
                }
            },
        })
    ).current;
    useEffect(() => {
        if (visible) {
            openModal();
        } else {
            translateY.setValue(MODAL_HEIGHT);
            backdropOpacity.setValue(0);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible]);

    const openModal = () => {
        Animated.parallel([
            Animated.spring(translateY, {
                toValue: 0,
                useNativeDriver: true,
                tension: 65,
                friction: 11,
            }),
            Animated.timing(backdropOpacity, {
                toValue: 1,
                duration: 300,
                useNativeDriver: true,
            }),
        ]).start();
    };

    const closeModal = () => {
        Animated.parallel([
            Animated.timing(translateY, {
                toValue: MODAL_HEIGHT,
                duration: 250,
                useNativeDriver: true,
            }),
            Animated.timing(backdropOpacity, {
                toValue: 0,
                duration: 250,
                useNativeDriver: true,
            }),
        ]).start(() => {
            onClose();
        });
    };

    const renderDeviceItem = ({ item }: { item: Device }) => (
        <View style={styles.deviceItem}>
            <View style={styles.deviceInfo}>
                <View
                    style={[
                        styles.deviceStatusDot,
                        item.isConnected ? styles.deviceStatusDotConnected : styles.deviceStatusDotDisconnected,
                    ]}
                />
                <View style={styles.deviceTextContainer}>
                    <Text style={styles.deviceName}>{item.name}</Text>
                    <Text style={styles.deviceStatus}>
                        {item.isFriend ? 'Friend' : 'Not Friend'}
                    </Text>
                </View>
            </View>
            <TouchableOpacity
                style={styles.actionButton}
                onPress={() =>
                    item.isFriend ? onMessage(item.id) : onAddFriend(item.id)
                }
                activeOpacity={0.7}
            >
                <Ionicons
                    name={item.isFriend ? 'chatbubble' : 'person-add'}
                    size={18}
                    color="#555151ff"
                />
            </TouchableOpacity>
        </View>
    );

    const friendsCount = devices.filter((d) => d.isFriend).length;

    return (
        <Modal
            visible={visible}
            transparent
            animationType="none"
            statusBarTranslucent
            onRequestClose={closeModal}
        >
            <View style={styles.container}>
                <TouchableWithoutFeedback onPress={closeModal}>
                    <Animated.View
                        style={[
                            styles.backdrop,
                            {
                                opacity: backdropOpacity,
                            },
                        ]}
                    />
                </TouchableWithoutFeedback>

                <Animated.View
                    style={[
                        styles.modalContent,
                        {
                            transform: [{ translateY }],
                        },
                    ]}
                >
                    <View style={styles.dragHandleContainer} {...panResponder.panHandlers}>
                        <View style={styles.dragHandle} />
                    </View>

                    <View style={styles.header}>
                        <View style={styles.headerTextContainer}>
                            <Text style={styles.title}>Nearby Devices</Text>
                            <Text style={styles.subtitle}>
                                Available: <Text style={styles.countText}>{friendsCount}</Text> /{' '}
                                {devices.length}
                            </Text>
                        </View>
                        <TouchableOpacity
                            style={styles.closeButton}
                            onPress={closeModal}
                            activeOpacity={0.7}
                        >
                            <Ionicons name="close" size={28} color="#F59E0B" />
                        </TouchableOpacity>
                    </View>

                    <FlatList
                        data={devices}
                        renderItem={renderDeviceItem}
                        keyExtractor={(item) => item.id}
                        showsVerticalScrollIndicator={false}
                        contentContainerStyle={styles.listContent}
                    />
                </Animated.View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
    },
    modalContent: {
        height: MODAL_HEIGHT,
        backgroundColor: '#292929',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        paddingHorizontal: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 10,
    },
    dragHandleContainer: {
        alignItems: 'center',
        paddingVertical: 12,
    },
    dragHandle: {
        width: 50,
        height: 4,
        backgroundColor: '#ffffffff',
        borderRadius: 2,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        paddingTop: 8,
        paddingBottom: 16,
    },
    headerTextContainer: {
        flex: 1,
    },
    title: {
        fontSize: 28,
        fontWeight: 'bold',
        color: '#E5E1DE',
        marginBottom: 4,
    },
    subtitle: {
        fontSize: 12,
        color: '#666',
    },
    countText: {
        fontSize: 16,
        fontWeight: '800',
        color: '#F59E0B',
    },
    closeButton: {
        padding: 4,
        marginLeft: 12,
    },
    listContent: {
        paddingBottom: 20,
    },
    deviceItem: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: '#FFF',
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 12,
        marginBottom: 8,
    },
    deviceInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    deviceTextContainer: {
        flex: 1,
    },
    deviceName: {
        fontSize: 16,
        fontWeight: '600',
        color: '#000',
        marginBottom: 2,
    },
    deviceStatus: {
        fontSize: 13,
        color: '#666',
    },
    deviceStatusDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        borderWidth: 1,
        borderColor: '#000',
        marginRight: 8,
    },
    deviceStatusDotConnected: {
        backgroundColor: '#22C55E',
    },
    deviceStatusDotDisconnected: {
        backgroundColor: '#EF4444',
    },
    actionButton: {
        padding: 8,
        marginLeft: 8,
    },
});

export default NearbyDevicesModal;